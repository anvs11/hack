"""Synchronous collection and ingestion orchestration."""

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.modules.publications.models import Publication
from backend.app.modules.sources.collectors import (
    CollectionFailed,
    CollectedPublication,
    Collector,
    CollectorSource,
    build_collector,
)
from backend.app.modules.sources.embeddings import (
    Embedder,
    EmbedderUnavailable,
    build_optional_embedder,
    cosine_similarity,
)
from backend.app.modules.sources.models import DuplicateCandidate, Source
from backend.app.modules.sources.schemas import (
    CollectionReport,
    SourceCollectionResult,
    SourceType,
)
from scripts.seed_core import content_hash


@dataclass(frozen=True)
class CollectionStats:
    collected: int
    created: int
    already_seen: int
    content_duplicates: int
    exact_duplicates: int
    semantic_candidates: int


@dataclass(frozen=True)
class _PublicationSnapshot:
    id: str
    source_id: str
    external_id: str
    canonical_url: str
    content_hash: str
    title: str
    content: str


@dataclass(frozen=True)
class _PreparedPublication:
    row: Publication
    title: str
    content: str


def collect_source(
    session: Session,
    source_id: str,
    *,
    collector: Collector | None = None,
    embedder: Embedder | None = None,
) -> CollectionReport | None:
    started_at = datetime.now(UTC)
    source = _load_source(session, source_id)
    if source is None:
        return None
    result = _collect_source(
        session,
        source,
        collector=collector,
        embedder=embedder or build_optional_embedder(),
    )
    return _collection_report([result], started_at)


def collect_enabled_sources(
    session: Session,
    *,
    include_demo: bool = False,
) -> CollectionReport:
    started_at = datetime.now(UTC)
    with session.begin():
        rows = list(
            session.scalars(select(Source).where(Source.enabled == 1).order_by(Source.id))
        )
        source_ids = [
            row.id
            for row in rows
            if include_demo or not json.loads(row.payload_json).get("is_demo", False)
        ]

    embedder = build_optional_embedder()
    results: list[SourceCollectionResult] = []
    for source_id in source_ids:
        source = _load_source(session, source_id)
        if source is not None:
            results.append(_collect_source(session, source, embedder=embedder))
    return _collection_report(results, started_at)


def _load_source(session: Session, source_id: str) -> CollectorSource | None:
    with session.begin():
        row = session.get(Source, source_id)
        if row is None:
            return None
        return CollectorSource(
            id=row.id,
            type=SourceType(row.type),
            url=row.url,
            is_demo=bool(json.loads(row.payload_json).get("is_demo", False)),
        )


def _collect_source(
    session: Session,
    source: CollectorSource,
    *,
    collector: Collector | None = None,
    embedder: Embedder | None = None,
) -> SourceCollectionResult:
    checked_at = datetime.now(UTC)
    try:
        result = (collector or build_collector(source.type)).collect(source)
        stats, semantic_error = _ingest(
            session,
            source,
            list(result.items),
            embedder,
            checked_at,
        )
    except (CollectionFailed, SQLAlchemyError, ValueError) as error:
        _record_status(session, source.id, checked_at, error=str(error))
        return SourceCollectionResult(
            source_id=source.id,
            status="failed",
            collected=0,
            created=0,
            already_seen=0,
            content_duplicates=0,
            exact_duplicates=0,
            semantic_candidates=0,
            error=str(error),
        )

    status = {
        "collected": stats.collected,
        "created": stats.created,
        "already_seen": stats.already_seen,
        "content_duplicates": stats.content_duplicates,
        "exact_duplicates": stats.exact_duplicates,
        "semantic_candidates": stats.semantic_candidates,
    }
    _record_status(
        session,
        source.id,
        checked_at,
        success=True,
        error=semantic_error,
        collection_status=status,
    )
    return SourceCollectionResult(
        source_id=source.id,
        status="partial" if semantic_error else "success",
        error=semantic_error,
        **status,
    )


def _collection_report(
    results: list[SourceCollectionResult],
    started_at: datetime,
) -> CollectionReport:
    failed = sum(result.status == "failed" for result in results)
    partial = sum(result.status == "partial" for result in results)
    if results and failed == len(results):
        status = "failed"
    elif failed or partial:
        status = "partial_failure"
    else:
        status = "completed"
    return CollectionReport(
        status=status,
        started_at=started_at,
        finished_at=datetime.now(UTC),
        sources=results,
        collected=sum(result.collected for result in results),
        created=sum(result.created for result in results),
        already_seen=sum(result.already_seen for result in results),
        content_duplicates=sum(result.content_duplicates for result in results),
        exact_duplicates=sum(result.exact_duplicates for result in results),
        semantic_candidates=sum(result.semantic_candidates for result in results),
    )


def _ingest(
    session: Session,
    source: CollectorSource,
    items: list[CollectedPublication],
    embedder: Embedder | None,
    collected_at: datetime,
) -> tuple[CollectionStats, str | None]:
    existing = _publication_snapshots(session)
    external_keys = {(item.source_id, item.external_id) for item in existing}
    canonical_urls = {item.canonical_url for item in existing}
    content_hashes = {item.content_hash for item in existing}
    prepared: list[_PreparedPublication] = []
    already_seen = 0
    content_duplicates = 0

    for item in items:
        canonical_url = _canonical_url(str(item.original_url))
        digest = content_hash(item.content)
        external_key = (source.id, item.external_id)
        if external_key in external_keys or canonical_url in canonical_urls:
            already_seen += 1
            continue
        if digest in content_hashes:
            content_duplicates += 1
            continue

        publication_id = f"publication-{uuid4().hex}"
        published_at = _iso_datetime(item.published_at)
        payload = {
            "id": publication_id,
            "source_id": source.id,
            "external_id": item.external_id,
            "title": item.title,
            "original_url": canonical_url,
            "published_at": published_at,
            "collected_at": _iso_datetime(collected_at),
            "content": item.content,
            "content_hash": digest,
            "is_demo": item.is_demo,
        }
        prepared.append(
            _PreparedPublication(
                row=Publication(
                    id=publication_id,
                    source_id=source.id,
                    external_id=item.external_id,
                    canonical_url=canonical_url,
                    content_hash=digest,
                    published_at=published_at,
                    payload_json=json.dumps(
                        payload,
                        ensure_ascii=False,
                        sort_keys=True,
                    ),
                ),
                title=item.title,
                content=item.content,
            )
        )
        external_keys.add(external_key)
        canonical_urls.add(canonical_url)
        content_hashes.add(digest)

    candidates: list[DuplicateCandidate] = []
    semantic_error: str | None = None
    if embedder is not None and prepared:
        try:
            candidates = _semantic_candidates(
                existing,
                prepared,
                embedder,
                collected_at,
            )
        except (EmbedderUnavailable, ValueError) as error:
            semantic_error = str(error)

    with session.begin():
        session.add_all(item.row for item in prepared)
        session.flush()
        session.add_all(candidates)

    return (
        CollectionStats(
            collected=len(items),
            created=len(prepared),
            already_seen=already_seen,
            content_duplicates=content_duplicates,
            exact_duplicates=already_seen + content_duplicates,
            semantic_candidates=len(candidates),
        ),
        semantic_error,
    )


def _publication_snapshots(session: Session) -> list[_PublicationSnapshot]:
    with session.begin():
        rows = list(session.scalars(select(Publication).order_by(Publication.id)))
        return [
            _PublicationSnapshot(
                id=row.id,
                source_id=row.source_id,
                external_id=row.external_id,
                canonical_url=_canonical_url(row.canonical_url),
                content_hash=row.content_hash,
                title=json.loads(row.payload_json)["title"],
                content=json.loads(row.payload_json)["content"],
            )
            for row in rows
        ]


def _semantic_candidates(
    existing: list[_PublicationSnapshot],
    prepared: list[_PreparedPublication],
    embedder: Embedder,
    created_at: datetime,
) -> list[DuplicateCandidate]:
    texts = [f"{item.title}\n{item.content}" for item in existing]
    texts.extend(f"{item.title}\n{item.content}" for item in prepared)
    vectors = embedder.embed(texts)
    if len(vectors) != len(texts):
        raise EmbedderUnavailable(
            "Embedding model returned an unexpected vector count"
        )

    candidate_rows: list[DuplicateCandidate] = []
    existing_count = len(existing)
    ids = [item.id for item in existing]
    ids.extend(item.row.id for item in prepared)
    for offset, publication in enumerate(prepared):
        vector_index = existing_count + offset
        if vector_index == 0:
            continue
        similarities = [
            cosine_similarity(vectors[vector_index], vectors[index])
            for index in range(vector_index)
        ]
        best_index = max(range(vector_index), key=similarities.__getitem__)
        candidate_rows.append(
            DuplicateCandidate(
                id=f"duplicate-{uuid4().hex}",
                publication_id=publication.row.id,
                candidate_publication_id=ids[best_index],
                model=embedder.model_id,
                similarity=similarities[best_index],
                status="unreviewed",
                created_at=_iso_datetime(created_at),
            )
        )
    return candidate_rows


def _record_status(
    session: Session,
    source_id: str,
    checked_at: datetime,
    *,
    success: bool = False,
    error: str | None,
    collection_status: dict[str, Any] | None = None,
) -> None:
    with session.begin():
        row = session.get(Source, source_id)
        if row is None:
            return
        payload = json.loads(row.payload_json)
        payload["last_checked_at"] = _iso_datetime(checked_at)
        if success:
            payload["last_success_at"] = _iso_datetime(checked_at)
        payload["last_error"] = error
        if collection_status is not None:
            payload["last_collection"] = collection_status
        row.payload_json = json.dumps(payload, ensure_ascii=False, sort_keys=True)


def _canonical_url(value: str) -> str:
    parsed = urlsplit(value)
    path = parsed.path.rstrip("/") or "/"
    return urlunsplit(
        (
            parsed.scheme.casefold(),
            parsed.netloc.casefold(),
            path,
            parsed.query,
            "",
        )
    )


def _iso_datetime(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
