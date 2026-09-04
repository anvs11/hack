"""Replaceable collectors for normalized publication inputs."""

import json
import re
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from html import unescape
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
        request = Request(source.url, headers={"User-Agent": "hack-monitor/0.2"})
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
                external_id=_required_text(item, "guid"),
                title=_required_text(item, "title"),
                original_url=_required_text(item, "link"),
                published_at=parsedate_to_datetime(_required_text(item, "pubDate")),
                content=_plain_text(_required_text(item, "description")),
            )
            for item in raw_items
        ]
    except (ElementTree.ParseError, TypeError, ValueError) as error:
        raise CollectionFailed("RSS source contains invalid RSS 2.0") from error
    if not items:
        raise CollectionFailed("RSS source contains no items")
    return CollectorResult(items=tuple(items))


def build_collector(source_type: SourceType) -> Collector:
    if source_type in {SourceType.FILE, SourceType.SEED}:
        return JsonFileCollector()
    if source_type is SourceType.RSS:
        return RssCollector()
    raise CollectionFailed(
        f"Collector for source type '{source_type.value}' is not implemented"
    )


def _open_url(request: Request, timeout: float) -> Any:
    return urlopen(request, timeout=timeout)


def _required_text(item: ElementTree.Element, name: str) -> str:
    value = item.findtext(name)
    if value is None or not value.strip():
        raise ValueError(f"RSS item is missing {name}")
    return value.strip()


def _plain_text(value: str) -> str:
    return " ".join(unescape(re.sub(r"<[^>]+>", " ", value)).split())
