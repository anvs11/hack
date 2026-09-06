#!/usr/bin/env python3
"""Find explicit NPA references in already collected publications.

The default is a read-only preview.  Use ``--apply`` only after inspecting the
number of matches; the command creates reviewable draft dossiers and links the
publications, but never creates lifecycle events or changes a legal stage.
"""

import argparse
import json
import sys
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.config import REPOSITORY_ROOT
from backend.app.db import build_engine, create_schema
from backend.app.modules.publications.models import Publication
from backend.app.modules.regulatory_cases.candidates import (
    extract_regulatory_case_candidates,
)
from backend.app.modules.regulatory_cases.service import (
    reconcile_publication_regulatory_cases,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--db",
        type=Path,
        default=REPOSITORY_ROOT / ".local/live.sqlite3",
        help="SQLite database path (defaults to the live local database)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Create or link reviewable draft dossiers; without it the command is read-only",
    )
    args = parser.parse_args()

    engine = build_engine(f"sqlite:///{args.db.resolve()}")
    if args.apply:
        create_schema(engine)
    try:
        with Session(engine, expire_on_commit=False) as session:
            publications = list(
                session.scalars(select(Publication).order_by(Publication.published_at.desc()))
            )
            matched_publications = 0
            candidate_references = 0
            candidate_publication_ids: list[str] = []
            for publication in publications:
                payload = json.loads(publication.payload_json)
                text = "\n".join(
                    str(payload.get(field, "")) for field in ("title", "content")
                )
                matches = extract_regulatory_case_candidates(text)
                if not matches:
                    continue
                matched_publications += 1
                candidate_references += len(matches)
                candidate_publication_ids.append(publication.id)
            # The preview query starts SQLAlchemy's implicit read transaction.
            # Reconciliation owns a small write transaction per publication.
            session.rollback()
            if args.apply:
                for publication_id in candidate_publication_ids:
                    reconcile_publication_regulatory_cases(session, publication_id)
            print(
                json.dumps(
                    {
                        "mode": "apply" if args.apply else "dry_run",
                        "publications_scanned": len(publications),
                        "publications_with_explicit_npa": matched_publications,
                        "candidate_references": candidate_references,
                        "lifecycle_events_created": 0,
                    },
                    ensure_ascii=False,
                )
            )
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
