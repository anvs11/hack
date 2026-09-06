from collections.abc import Generator
from pathlib import Path

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from backend.app.db import build_engine
from backend.app.modules.analysis.models import AnalysisVersion
from backend.app.modules.publications.models import Publication
from backend.app.modules.sources.models import Source
from backend.tests.seed import seed_test_database


@pytest.fixture
def seeded_engine(tmp_path: Path) -> Generator[Engine, None, None]:
    engine = build_engine(f"sqlite:///{tmp_path / 'api-seed.sqlite3'}")
    yield engine
    engine.dispose()


def _counts(engine: Engine) -> tuple[int, int, int]:
    with Session(engine) as session:
        return (
            session.scalar(select(func.count()).select_from(Source)) or 0,
            session.scalar(select(func.count()).select_from(Publication)) or 0,
            session.scalar(select(func.count()).select_from(AnalysisVersion)) or 0,
        )


def test_test_fixture_import_is_idempotent(seeded_engine: Engine) -> None:
    engine = seeded_engine

    assert seed_test_database(engine) == (5, 10, 10)
    assert seed_test_database(engine) == (5, 10, 10)
    assert _counts(engine) == (5, 10, 10)
