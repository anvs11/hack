import subprocess
import sys
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, inspect, select
from sqlalchemy.orm import Session

from backend.app.db import build_engine, create_schema
from backend.app.main import create_app
from backend.app.modules.analysis.models import AnalysisVersion
from backend.app.modules.publications.models import Publication
from backend.app.modules.sources.models import Source


EXPECTED_COUNTS = (5, 10, 10)
REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def _seed(database_path: Path) -> None:
    result = subprocess.run(
        [sys.executable, "scripts/seed_demo.py", "--db", str(database_path)],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    assert "sources=5, publications=10, analyses=10" in result.stdout


def _counts(engine: Engine) -> tuple[int, int, int]:
    with Session(engine) as session:
        return (
            session.scalar(select(func.count()).select_from(Source)) or 0,
            session.scalar(select(func.count()).select_from(Publication)) or 0,
            session.scalar(select(func.count()).select_from(AnalysisVersion)) or 0,
        )


def test_create_schema_builds_the_current_tables(tmp_path: Path) -> None:
    engine = build_engine(f"sqlite:///{tmp_path / 'clean.sqlite3'}")

    create_schema(engine)

    assert set(inspect(engine).get_table_names()) == {
        "analysis_versions",
        "duplicate_candidates",
        "lifecycle_events",
        "publications",
        "regulatory_case_publications",
        "regulatory_cases",
        "sources",
        "specialist_decisions",
    }
    assert _counts(engine) == (0, 0, 0)
    engine.dispose()


def test_cli_seed_is_readable_through_orm(tmp_path: Path) -> None:
    database_path = tmp_path / "seed.sqlite3"
    _seed(database_path)
    engine = build_engine(f"sqlite:///{database_path}")

    create_schema(engine)

    assert _counts(engine) == EXPECTED_COUNTS
    with Session(engine) as session:
        assert len(session.scalars(select(Source)).all()) == 5
        assert len(session.scalars(select(Publication)).all()) == 10
        assert len(session.scalars(select(AnalysisVersion)).all()) == 10
    engine.dispose()


def test_repeated_application_startup_preserves_seed_rows(tmp_path: Path) -> None:
    database_path = tmp_path / "restart.sqlite3"
    _seed(database_path)
    engine = build_engine(f"sqlite:///{database_path}")

    for _ in range(2):
        with TestClient(create_app(database_engine=engine)) as client:
            assert client.get("/api/health").json() == {"status": "ok"}

    assert _counts(engine) == EXPECTED_COUNTS
    engine.dispose()
