import json
from pathlib import Path

from sqlalchemy.orm import Session

from backend.app.db import build_engine, create_schema
from backend.app.modules.sources.catalog import sync_source_catalog
from backend.app.modules.sources.models import Source


def test_source_catalog_sync_is_idempotent_and_preserves_status(tmp_path: Path) -> None:
    catalog = tmp_path / "sources.json"
    catalog.write_text(
        json.dumps(
            [
                {
                    "id": "tg-example",
                    "name": "Example",
                    "type": "telegram",
                    "url": "https://t.me/example_channel",
                    "enabled": True,
                }
            ]
        ),
        encoding="utf-8",
    )
    engine = build_engine(f"sqlite:///{tmp_path / 'catalog.sqlite3'}")
    create_schema(engine)

    with Session(engine) as session:
        assert sync_source_catalog(session, catalog) == (1, 0)
        row = session.get(Source, "tg-example")
        assert row is not None
        payload = json.loads(row.payload_json)
        payload["last_success_at"] = "2026-09-05T08:00:00Z"
        row.payload_json = json.dumps(payload)
        session.commit()
    with Session(engine) as session:
        assert sync_source_catalog(session, catalog) == (0, 1)
        row = session.get(Source, "tg-example")
        assert row is not None
        assert json.loads(row.payload_json)["last_success_at"] == (
            "2026-09-05T08:00:00Z"
        )
    engine.dispose()
