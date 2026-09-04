"""Transactional read and write operations for configured sources."""

import json
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.modules.sources.models import Source as SourceModel
from backend.app.modules.sources.schemas import (
    SourceCreate,
    SourcePatch,
    SourceResponse,
)


def list_sources(session: Session) -> list[SourceResponse]:
    rows = session.scalars(select(SourceModel).order_by(SourceModel.id)).all()
    return [_source_response(row) for row in rows]


def create_source(session: Session, source: SourceCreate) -> SourceResponse:
    source_id = f"source-{uuid4().hex}"
    payload = {
        "id": source_id,
        "name": source.name,
        "type": source.type.value,
        "url": str(source.url),
        "enabled": source.enabled,
        "last_checked_at": None,
        "last_success_at": None,
        "last_error": None,
        "is_demo": False,
    }
    row = SourceModel(
        id=source_id,
        name=source.name,
        type=source.type.value,
        url=str(source.url),
        enabled=int(source.enabled),
        payload_json=json.dumps(payload, ensure_ascii=False, sort_keys=True),
    )
    with session.begin():
        session.add(row)
        session.flush()
    return _source_response(row)


def update_source(
    session: Session,
    source_id: str,
    patch: SourcePatch,
) -> SourceResponse | None:
    with session.begin():
        row = session.get(SourceModel, source_id)
        if row is None:
            return None

        payload = json.loads(row.payload_json)
        values = patch.model_dump(exclude_unset=True)
        if "name" in values:
            row.name = values["name"]
            payload["name"] = values["name"]
        if "url" in values:
            row.url = str(values["url"])
            payload["url"] = row.url
        if "enabled" in values:
            row.enabled = int(values["enabled"])
            payload["enabled"] = values["enabled"]
        row.payload_json = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        session.flush()
    return _source_response(row)


def _source_response(row: SourceModel) -> SourceResponse:
    payload = json.loads(row.payload_json)
    return SourceResponse(
        id=row.id,
        name=row.name,
        type=row.type,
        url=row.url,
        enabled=bool(row.enabled),
        last_checked_at=payload.get("last_checked_at"),
        last_success_at=payload.get("last_success_at"),
        last_error=payload.get("last_error"),
        is_demo=bool(payload.get("is_demo", False)),
    )
