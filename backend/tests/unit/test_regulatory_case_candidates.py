import json

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.db import build_engine, create_schema
from backend.app.modules.publications.hashing import content_hash
from backend.app.modules.publications.models import Publication
from backend.app.modules.regulatory_cases.candidates import (
    extract_regulatory_case_candidates,
)
from backend.app.modules.regulatory_cases.models import (
    LifecycleEvent,
    RegulatoryCase,
    RegulatoryCasePublication,
)
from backend.app.modules.regulatory_cases.service import (
    reconcile_publication_regulatory_cases,
)
from backend.app.modules.sources.models import Source


def test_extracts_only_explicit_numbered_regulatory_documents() -> None:
    candidates = extract_regulatory_case_candidates(
        "Новости регулирования. Федеральный закон от 31.07.2025 № 321-ФЗ "
        "и законопроект № 123456-8 направлены на рассмотрение."
    )

    assert [(item.registration_number, item.identifier_key) for item in candidates] == [
        ("ФЗ № 321-ФЗ", "federal_law:321-фз"),
        ("Законопроект № 123456-8", "bill:123456-8"),
    ]
    assert extract_regulatory_case_candidates(
        "Регуляторика и законодательные инициативы без номера документа."
    ) == []


def test_reconciliation_creates_one_reviewable_draft_and_links_all_mentions(tmp_path) -> None:
    engine = build_engine(f"sqlite:///{tmp_path / 'npa.sqlite3'}")
    create_schema(engine)
    content = "Правительство обсуждает Федеральный закон № 321-ФЗ."
    payload = {
        "id": "publication-npa-001",
        "title": "Новость о Федеральном законе № 321-ФЗ",
        "content": content,
    }
    with Session(engine) as session:
        with session.begin():
            session.add(
                Source(
                    id="source-001",
                    name="Тестовый источник",
                    type="rss",
                    url="https://example.org/feed",
                    enabled=1,
                    payload_json="{}",
                )
            )
            session.flush()
            session.add(
                Publication(
                    id="publication-npa-001",
                    source_id="source-001",
                    external_id="npa-001",
                    canonical_url="https://example.org/npa-001",
                    content_hash=content_hash(content),
                    published_at="2026-09-06T10:00:00Z",
                    payload_json=json.dumps(payload, ensure_ascii=False),
                )
            )

        assert reconcile_publication_regulatory_cases(session, "publication-npa-001") == 1
        assert reconcile_publication_regulatory_cases(session, "publication-npa-001") == 1

        case = session.scalar(select(RegulatoryCase))
        assert case is not None
        assert case.current_stage == "draft"
        assert case.origin == "automatic"
        assert case.needs_review == 1
        assert case.responsible_user_id == "unassigned"
        assert session.scalar(select(func.count()).select_from(RegulatoryCase)) == 1
        assert session.scalar(select(func.count()).select_from(RegulatoryCasePublication)) == 1
        assert session.scalar(select(func.count()).select_from(LifecycleEvent)) == 0
    engine.dispose()
