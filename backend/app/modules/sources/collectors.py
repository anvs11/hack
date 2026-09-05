"""Replaceable collectors for normalized publication inputs."""

import ipaddress
import json
import re
import socket
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable, Protocol
from urllib.parse import unquote, urlsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree

from pydantic import AwareDatetime, AnyUrl, BaseModel, ConfigDict, Field, TypeAdapter

from backend.app.config import get_collection_file_root
from backend.app.modules.sources.schemas import SourceType


class CollectionFailed(RuntimeError):
    pass


class CollectedPublication(BaseModel):
    model_config = ConfigDict(extra="forbid")

    external_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    original_url: AnyUrl
    published_at: AwareDatetime
    content: str = Field(min_length=1)
    is_demo: bool = False


@dataclass(frozen=True)
class CollectorSource:
    id: str
    type: SourceType
    url: str
    is_demo: bool = False


@dataclass(frozen=True)
class CollectorResult:
    items: tuple[CollectedPublication, ...]


class Collector(Protocol):
    def collect(self, source: CollectorSource) -> CollectorResult: ...


class JsonFileCollector:
    """Read a strict JSON array without network access."""

    def __init__(self, allowed_root: Path | None = None) -> None:
        self.allowed_root = (allowed_root or get_collection_file_root()).resolve()

    def collect(self, source: CollectorSource) -> CollectorResult:
        parsed = urlsplit(source.url)
        if parsed.scheme != "file" or parsed.netloc not in ("", "localhost"):
            raise CollectionFailed("File source must use a local file:// URL")
        path = Path(unquote(parsed.path)).resolve()
        if not path.is_relative_to(self.allowed_root):
            raise CollectionFailed("File source is outside HACK_COLLECTION_FILE_ROOT")

        try:
            with path.open(encoding="utf-8") as stream:
                payload = json.load(stream)
            items = TypeAdapter(list[CollectedPublication]).validate_python(payload)
        except (OSError, json.JSONDecodeError, ValueError) as error:
            raise CollectionFailed(
                "File source contains invalid publication JSON"
            ) from error
        return CollectorResult(items=tuple(items))


RssOpener = Callable[[Request, float], Any]


class RssCollector:
    """Fetch and parse a small RSS 2.0 feed using the standard library."""

    def __init__(self, opener: RssOpener | None = None) -> None:
        self._opener = opener or _open_url

    def collect(self, source: CollectorSource) -> CollectorResult:
        if source.is_demo:
            raise CollectionFailed("Demo RSS source has no local collection fixture")
        if urlsplit(source.url).scheme not in {"http", "https"}:
            raise CollectionFailed("RSS source must use an http(s) URL")
        _require_public_network_url(source.url)
        request = Request(source.url, headers={"User-Agent": "hack-monitor/0.3"})
        try:
            with self._opener(request, 10.0) as response:
                payload = response.read(2_000_001)
        except OSError as error:
            raise CollectionFailed("RSS source could not be downloaded") from error
        if len(payload) > 2_000_000:
            raise CollectionFailed("RSS source exceeds the 2 MB limit")
        return parse_rss(payload)


def parse_rss(payload: bytes) -> CollectorResult:
    try:
        root = ElementTree.fromstring(payload)
        raw_items = root.findall("./channel/item")
        items = [
            CollectedPublication(
                external_id=_optional_text(item, "guid") or _required_text(item, "link"),
                title=_required_text(item, "title"),
                original_url=_required_text(item, "link"),
                published_at=parsedate_to_datetime(_required_text(item, "pubDate")),
                content=_plain_text(
                    _optional_text(item, "description")
                    or _required_text(item, "title")
                ),
            )
            for item in raw_items
        ][:100]
    except (ElementTree.ParseError, TypeError, ValueError) as error:
        raise CollectionFailed("RSS source contains invalid RSS 2.0") from error
    if not items:
        raise CollectionFailed("RSS source contains no items")
    return CollectorResult(items=tuple(items))


class TelegramPublicCollector:
    """Read the latest posts exposed by a public Telegram web preview."""

    def __init__(self, opener: RssOpener | None = None) -> None:
        self._opener = opener or _open_url

    def collect(self, source: CollectorSource) -> CollectorResult:
        channel = _telegram_channel(source.url)
        preview_url = f"https://t.me/s/{channel}"
        request = Request(preview_url, headers={"User-Agent": "hack-monitor/0.3"})
        try:
            with self._opener(request, 10.0) as response:
                payload = response.read(2_000_001)
        except OSError as error:
            raise CollectionFailed(
                "Telegram public preview could not be downloaded"
            ) from error
        if len(payload) > 2_000_000:
            raise CollectionFailed("Telegram public preview exceeds the 2 MB limit")
        return parse_telegram_preview(payload)


def parse_telegram_preview(payload: bytes) -> CollectorResult:
    parser = _TelegramPreviewParser()
    try:
        parser.feed(payload.decode("utf-8"))
        parser.close()
    except (UnicodeDecodeError, ValueError) as error:
        raise CollectionFailed("Telegram public preview contains invalid HTML") from error
    if not parser.items:
        raise CollectionFailed("Telegram public preview contains no text posts")
    return CollectorResult(items=tuple(parser.items[:100]))


class _TelegramPreviewParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.items: list[CollectedPublication] = []
        self._div_depth = 0
        self._message_depth: int | None = None
        self._text_depth: int | None = None
        self._post: str | None = None
        self._published_at: str | None = None
        self._chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "div":
            self._div_depth += 1
            classes = set((attributes.get("class") or "").split())
            if self._message_depth is None and attributes.get("data-post"):
                self._message_depth = self._div_depth
                self._post = attributes["data-post"]
                self._published_at = None
                self._chunks = []
            elif (
                self._message_depth is not None
                and "tgme_widget_message_text" in classes
            ):
                self._text_depth = self._div_depth
        elif tag == "time" and self._message_depth is not None:
            self._published_at = attributes.get("datetime")
        elif tag == "br" and self._text_depth is not None:
            self._chunks.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag != "div":
            return
        if self._text_depth == self._div_depth:
            self._text_depth = None
        if self._message_depth == self._div_depth:
            self._finish_message()
        self._div_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._text_depth is not None:
            self._chunks.append(data)

    def _finish_message(self) -> None:
        content = _plain_text(" ".join(self._chunks))
        if self._post and self._published_at and content:
            title = content.splitlines()[0].strip()[:160] or content[:160]
            self.items.append(
                CollectedPublication(
                    external_id=self._post,
                    title=title,
                    original_url=f"https://t.me/{self._post}",
                    published_at=self._published_at,
                    content=content,
                )
            )
        self._message_depth = None
        self._text_depth = None
        self._post = None
        self._published_at = None
        self._chunks = []


def build_collector(source_type: SourceType) -> Collector:
    if source_type in {SourceType.FILE, SourceType.SEED}:
        return JsonFileCollector()
    if source_type is SourceType.RSS:
        return RssCollector()
    if source_type is SourceType.TELEGRAM:
        return TelegramPublicCollector()
    raise CollectionFailed(
        f"Collector for source type '{source_type.value}' is not implemented"
    )


def _open_url(request: Request, timeout: float) -> Any:
    return urlopen(request, timeout=timeout)


def _required_text(item: ElementTree.Element, name: str) -> str:
    value = _optional_text(item, name)
    if value is None or not value.strip():
        raise ValueError(f"RSS item is missing {name}")
    return value.strip()


def _optional_text(item: ElementTree.Element, name: str) -> str | None:
    value = item.findtext(name)
    return value.strip() if value and value.strip() else None


def _plain_text(value: str) -> str:
    return " ".join(unescape(re.sub(r"<[^>]+>", " ", value)).split())


def _telegram_channel(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or parsed.netloc.casefold() not in {
        "t.me",
        "www.t.me",
    }:
        raise CollectionFailed("Telegram source must use a public t.me channel URL")
    parts = [part for part in parsed.path.split("/") if part]
    if parts[:1] == ["s"]:
        parts = parts[1:]
    if len(parts) != 1 or not re.fullmatch(r"[A-Za-z0-9_]{5,32}", parts[0]):
        raise CollectionFailed("Telegram source must point to a public channel")
    return parts[0]


def _require_public_network_url(value: str) -> None:
    parsed = urlsplit(value)
    hostname = parsed.hostname
    if not hostname:
        raise CollectionFailed("Network source URL has no hostname")
    normalized = hostname.casefold()
    if normalized == "localhost" or normalized.endswith(".local"):
        raise CollectionFailed("Network source cannot target a local address")
    try:
        addresses = [ipaddress.ip_address(hostname)]
    except ValueError:
        try:
            addresses = [
                ipaddress.ip_address(item[4][0])
                for item in socket.getaddrinfo(
                    hostname,
                    parsed.port or 443,
                    type=socket.SOCK_STREAM,
                )
            ]
        except OSError as error:
            raise CollectionFailed(
                "Network source hostname could not be resolved"
            ) from error
    if any(not address.is_global for address in addresses):
        raise CollectionFailed("Network source cannot target a private address")
