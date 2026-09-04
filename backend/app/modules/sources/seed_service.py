"""Application service for the versioned offline demo seed."""

from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from backend.app.modules.publications.models import Publication
from scripts.seed_core import import_seed, load_json, validate_seed


@dataclass(frozen=True)
class SeedImportStats:
    sources: int
    publications: int
    analyses: int
    duplicates: int


def _sqlite_path(engine: Engine) -> Path:
    database = engine.url.database
    if engine.dialect.name != "sqlite" or database in (None, "", ":memory:"):
        raise ValueError("offline seed import requires a file-based SQLite database")
    return Path(database)


def import_demo_seed(engine: Engine) -> SeedImportStats:
    """Upsert the fixed seed and report already present publication IDs."""

    sources = load_json("sources.json")
    publications = load_json("publications.json")
    analyses = load_json("replay-analyses.json")
    regulatory_cases = load_json("regulatory-cases.json")
    validate_seed(sources, publications, analyses, regulatory_cases)

    publication_ids = {item["id"] for item in publications}
    with Session(engine) as session:
        existing_ids = set(
            session.scalars(
                select(Publication.id).where(Publication.id.in_(publication_ids))
            )
        )

    import_seed(_sqlite_path(engine))
    return SeedImportStats(
        sources=len(sources),
        publications=len(publications),
        analyses=len(analyses),
        duplicates=len(existing_ids),
    )
