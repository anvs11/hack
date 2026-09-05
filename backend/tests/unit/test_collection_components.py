from pathlib import Path

import pytest

from backend.app.modules.sources.collectors import (
    CollectionFailed,
    CollectorSource,
    JsonFileCollector,
    RssCollector,
    TelegramPublicCollector,
    parse_rss,
    parse_telegram_preview,
)
from backend.app.modules.sources.embeddings import (
    HuggingFaceEmbedder,
    cosine_similarity,
)
from backend.app.modules.sources.schemas import SourceType


FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def test_file_collector_reads_strict_offline_fixture() -> None:
    result = JsonFileCollector(allowed_root=FIXTURES).collect(
        CollectorSource(
            id="source-file",
            type=SourceType.FILE,
            url=(FIXTURES / "collection-feed.json").as_uri(),
        )
    )

    assert len(result.items) == 4
    assert result.items[0].external_id == "offline-001"


def test_file_collector_rejects_invalid_payload() -> None:
    with pytest.raises(CollectionFailed):
        JsonFileCollector(allowed_root=FIXTURES).collect(
            CollectorSource(
                id="source-file",
                type=SourceType.FILE,
                url=(FIXTURES / "invalid-collection-feed.json").as_uri(),
            )
        )


def test_file_collector_rejects_path_outside_allowed_root(tmp_path: Path) -> None:
    outside = tmp_path / "outside.json"
    outside.write_text("[]", encoding="utf-8")

    with pytest.raises(CollectionFailed):
        JsonFileCollector(allowed_root=FIXTURES).collect(
            CollectorSource(
                id="source-file",
                type=SourceType.FILE,
                url=outside.as_uri(),
            )
        )


def test_rss_parser_uses_saved_fixture_without_network() -> None:
    result = parse_rss((FIXTURES / "rss-feed.xml").read_bytes())

    assert len(result.items) == 1
    assert result.items[0].external_id == "rss-001"
    expected = "Документ опубликован для общественного обсуждения."
    assert result.items[0].content == expected


def test_rss_parser_accepts_feeds_without_description_or_guid() -> None:
    result = parse_rss(
        b"""<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0"><channel><item>
          <title>Only title is available</title>
          <link>https://example.com/news/42</link>
          <pubDate>Fri, 05 Sep 2026 08:15:00 +0000</pubDate>
        </item></channel></rss>"""
    )

    assert result.items[0].external_id == "https://example.com/news/42"
    assert result.items[0].content == "Only title is available"


def test_rss_collector_rejects_private_network_targets() -> None:
    collector = RssCollector(opener=lambda *_args: pytest.fail("opener must not run"))

    with pytest.raises(CollectionFailed, match="private address"):
        collector.collect(
            CollectorSource(
                id="source-private",
                type=SourceType.RSS,
                url="http://127.0.0.1/feed.xml",
            )
        )


def test_telegram_preview_parser_reads_text_posts_without_network() -> None:
    result = parse_telegram_preview(
        (FIXTURES / "telegram-preview.html").read_bytes()
    )

    assert len(result.items) == 1
    assert result.items[0].external_id == "rfrit/1234"
    assert str(result.items[0].original_url) == "https://t.me/rfrit/1234"
    assert result.items[0].content == (
        "Правительство утвердило перечень проектов. "
        "Подробности опубликованы на сайте фонда."
    )


def test_telegram_collector_rejects_non_public_channel_url() -> None:
    collector = TelegramPublicCollector()

    with pytest.raises(CollectionFailed, match="public t.me"):
        collector.collect(
            CollectorSource(
                id="source-telegram",
                type=SourceType.TELEGRAM,
                url="https://example.com/channel",
            )
        )


def test_cosine_similarity_has_expected_boundaries() -> None:
    assert cosine_similarity([1.0, 0.0], [1.0, 0.0]) == pytest.approx(1.0)
    assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)
    assert cosine_similarity([1.0, 0.0], [-1.0, 0.0]) == pytest.approx(-1.0)


def test_embedding_adapter_is_lazy() -> None:
    received = []

    class FakeModel:
        def encode(self, texts, **kwargs):
            received.extend(texts)
            assert kwargs["batch_size"] == 2
            assert kwargs["show_progress_bar"] is False

            class Vectors:
                @staticmethod
                def tolist() -> list[list[float]]:
                    return [[1.0, 0.0]]

            return Vectors()

    embedder = HuggingFaceEmbedder(
        model=FakeModel(),
        max_input_chars=4,
        batch_size=2,
    )

    assert embedder.embed(["текст длиннее"]) == [[1.0, 0.0]]
    assert received == ["текс"]
