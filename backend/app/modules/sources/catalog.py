"""Idempotent import of a reviewed live-source catalog."""

import json
from pathlib import Path

from pydantic import AnyUrl, BaseModel, ConfigDict, Field, TypeAdapter
from sqlalchemy.orm import Session

from backend.app.modules.sources.models import Source
from backend.app.modules.sources.schemas import SourceType


class CatalogSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    type: SourceType
    url: AnyUrl
    enabled: bool = True


def sync_source_catalog(session: Session, path: Path) -> tuple[int, int]:
    rows = TypeAdapter(list[CatalogSource]).validate_json(path.read_text("utf-8"))
    created = 0
    updated = 0
    with session.begin():
        for source in rows:
            row = session.get(Source, source.id)
            if row is None:
                payload = {
                    **source.model_dump(mode="json"),
                    "last_checked_at": None,
                    "last_success_at": None,
                    "last_error": None,
                    "is_demo": False,
                }
                session.add(
                    Source(
                        id=source.id,
                        name=source.name,
                        type=source.type.value,
                        url=str(source.url),
                        enabled=int(source.enabled),
                        payload_json=json.dumps(
                            payload,
                            ensure_ascii=False,
                            sort_keys=True,
                        ),
                    )
                )
                created += 1
                continue

            payload = json.loads(row.payload_json)
            row.name = source.name
            row.type = source.type.value
            row.url = str(source.url)
            row.enabled = int(source.enabled)
            payload.update(source.model_dump(mode="json"))
            payload["is_demo"] = False
            row.payload_json = json.dumps(
                payload,
                ensure_ascii=False,
                sort_keys=True,
            )
            updated += 1
    return created, updated
