"""Synthetic records used only inside isolated test databases."""

from pathlib import Path

from sqlalchemy import Engine

from scripts.seed_core import import_seed


def seed_test_database(engine: Engine) -> tuple[int, int, int]:
    database = engine.url.database
    if not database:
        raise ValueError("test seed requires a file-based database")
    return import_seed(Path(database))
