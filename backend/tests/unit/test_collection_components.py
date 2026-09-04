from pathlib import Path

import pytest

from backend.app.modules.sources.collectors import (
    CollectionFailed,
    CollectorSource,
    JsonFileCollector,
    parse_rss,
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


def test_cosine_similarity_has_expected_boundaries() -> None:
    assert cosine_similarity([1.0, 0.0], [1.0, 0.0]) == pytest.approx(1.0)
    assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)
    assert cosine_similarity([1.0, 0.0], [-1.0, 0.0]) == pytest.approx(-1.0)


def test_embedding_adapter_is_lazy() -> None:
    class FakeModel:
        def encode(self, *_args, **_kwargs):
            class Vectors:
                @staticmethod
                def tolist() -> list[list[float]]:
                    return [[1.0, 0.0]]

            return Vectors()

    embedder = HuggingFaceEmbedder(model=FakeModel())

    assert embedder.embed(["текст"]) == [[1.0, 0.0]]
