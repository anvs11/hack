"""Read, backfill and review semantic duplicate candidates."""

import json
import time
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.modules.publications.service import get_publication
from backend.app.modules.sources.dedup_schemas import (
    DuplicateBackfillReport,
    DuplicateCandidateList,
    DuplicateCandidateResponse,
    DuplicateReviewCreate,
    DuplicateReviewResponse,
)
from backend.app.modules.sources.embeddings import Embedder, cosine_similarity
from backend.app.modules.sources.models import (
    DuplicateCandidate,
    DuplicateReview,
    PublicationEmbedding,
)
from backend.app.modules.publications.models import Publication


def list_duplicate_candidates(
    session: Session,
    *,
    status: str | None,
    limit: int,
    offset: int,
) -> DuplicateCandidateList:
    where = [] if status is None else [DuplicateCandidate.status == status]
    total = session.scalar(
        select(func.count()).select_from(DuplicateCandidate).where(*where)
    ) or 0
    rows = list(
        session.scalars(
            select(DuplicateCandidate)
            .where(*where)
            .order_by(DuplicateCandidate.similarity.desc(), DuplicateCandidate.id)
            .offset(offset)
            .limit(limit)
        )
    )
    return DuplicateCandidateList(
        items=[_candidate_response(session, row) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


def get_duplicate_candidate(
    session: Session,
    candidate_id: str,
) -> DuplicateCandidateResponse | None:
    row = session.get(DuplicateCandidate, candidate_id)
    return _candidate_response(session, row) if row is not None else None


def create_duplicate_review(
    session: Session,
    candidate_id: str,
    request: DuplicateReviewCreate,
) -> DuplicateCandidateResponse | None:
    with session.begin():
        candidate = session.get(DuplicateCandidate, candidate_id)
        if candidate is None:
            return None
        version = session.scalar(
            select(func.max(DuplicateReview.version)).where(
                DuplicateReview.candidate_id == candidate_id
            )
        ) or 0
        review = DuplicateReview(
            id=f"duplicate-review-{uuid4().hex}",
            candidate_id=candidate_id,
            version=version + 1,
            verdict=request.verdict.value,
            reviewer_id=request.reviewer_id,
            comment=(request.comment.strip() or None) if request.comment else None,
            created_at=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        )
        candidate.status = request.verdict.value
        session.add(review)
        session.flush()
    return get_duplicate_candidate(session, candidate_id)


def backfill_duplicate_candidates(
    session: Session,
    embedder: Embedder,
    *,
    limit: int | None = None,
) -> DuplicateBackfillReport:
    started = time.perf_counter()
    rows = list(
        session.scalars(
            select(Publication).order_by(Publication.published_at, Publication.id)
        )
    )
    publications = [
        (row.id, json.loads(row.payload_json))
        for row in rows
    ]
    if limit is not None:
        publications = publications[:limit]
    existing_ids = set(
        session.scalars(
            select(DuplicateCandidate.publication_id).where(
                DuplicateCandidate.model == embedder.model_id
            )
        )
    )
    existing_ids.intersection_update(publication_id for publication_id, _ in publications)
    session.rollback()
    if len(publications) <= 1 or len(existing_ids) >= len(publications) - 1:
        return DuplicateBackfillReport(
            model=embedder.model_id,
            publications=len(publications),
            candidates_created=0,
            candidates_already_present=len(existing_ids),
            duration_seconds=round(time.perf_counter() - started, 3),
        )
    vectors = _publication_vectors(session, publications, embedder)
    if vectors and len(vectors) != len(publications):
        raise ValueError("Embedding model returned an unexpected vector count")

    created = []
    for index, (publication_id, _payload) in enumerate(publications):
        if index == 0 or publication_id in existing_ids:
            continue
        similarities = [
            cosine_similarity(vectors[index], vectors[candidate_index])
            for candidate_index in range(index)
        ]
        best_index = max(range(index), key=similarities.__getitem__)
        created.append(
            DuplicateCandidate(
                id=f"duplicate-{uuid4().hex}",
                publication_id=publication_id,
                candidate_publication_id=publications[best_index][0],
                model=embedder.model_id,
                similarity=similarities[best_index],
                status="unreviewed",
                created_at=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            )
        )
    with session.begin():
        session.add_all(created)
    return DuplicateBackfillReport(
        model=embedder.model_id,
        publications=len(publications),
        candidates_created=len(created),
        candidates_already_present=len(existing_ids),
        duration_seconds=round(time.perf_counter() - started, 3),
    )


def _publication_vectors(
    session: Session,
    publications: list[tuple[str, dict]],
    embedder: Embedder,
    *,
    persist_batch_size: int = 32,
) -> list[list[float]]:
    publication_ids = [publication_id for publication_id, _payload in publications]
    with session.begin():
        cached_rows = list(
            session.scalars(
                select(PublicationEmbedding).where(
                    PublicationEmbedding.model == embedder.model_id,
                    PublicationEmbedding.publication_id.in_(publication_ids),
                )
            )
        )
    cached = {
        row.publication_id: (row.content_hash, json.loads(row.vector_json))
        for row in cached_rows
    }
    missing = [
        (publication_id, payload)
        for publication_id, payload in publications
        if publication_id not in cached
        or cached[publication_id][0] != payload["content_hash"]
    ]
    for start in range(0, len(missing), persist_batch_size):
        batch = missing[start : start + persist_batch_size]
        texts = [f"{payload['title']}\n{payload['content']}" for _id, payload in batch]
        vectors = embedder.embed(texts)
        if len(vectors) != len(batch):
            raise ValueError("Embedding model returned an unexpected vector count")
        created_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        with session.begin():
            for (publication_id, payload), vector in zip(batch, vectors, strict=True):
                row = session.get(
                    PublicationEmbedding,
                    (publication_id, embedder.model_id),
                )
                if row is None:
                    row = PublicationEmbedding(
                        publication_id=publication_id,
                        model=embedder.model_id,
                        content_hash=payload["content_hash"],
                        vector_json=json.dumps(vector),
                        created_at=created_at,
                    )
                    session.add(row)
                else:
                    row.content_hash = payload["content_hash"]
                    row.vector_json = json.dumps(vector)
                    row.created_at = created_at
                cached[publication_id] = (payload["content_hash"], vector)
    return [cached[publication_id][1] for publication_id in publication_ids]


def _candidate_response(
    session: Session,
    row: DuplicateCandidate,
) -> DuplicateCandidateResponse:
    publication = get_publication(session, row.publication_id)
    candidate_publication = get_publication(session, row.candidate_publication_id)
    if publication is None or candidate_publication is None:
        raise RuntimeError("Duplicate candidate points to a missing publication")
    reviews = list(
        session.scalars(
            select(DuplicateReview)
            .where(DuplicateReview.candidate_id == row.id)
            .order_by(DuplicateReview.version)
        )
    )
    return DuplicateCandidateResponse(
        id=row.id,
        publication=publication,
        candidate_publication=candidate_publication,
        model=row.model,
        similarity=row.similarity,
        status=row.status,
        reviews=[_review_response(review) for review in reviews],
        created_at=row.created_at,
    )


def _review_response(row: DuplicateReview) -> DuplicateReviewResponse:
    return DuplicateReviewResponse(
        id=row.id,
        candidate_id=row.candidate_id,
        version=row.version,
        verdict=row.verdict,
        reviewer_id=row.reviewer_id,
        comment=row.comment,
        created_at=row.created_at,
    )
