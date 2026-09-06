#!/usr/bin/env python3
"""Run live collection once or periodically in a separate process."""

import argparse
import json
import sys
import time
from pathlib import Path

from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.config import (
    REPOSITORY_ROOT,
    get_auto_analysis_batch_size,
    get_auto_analysis_min_content_chars,
    get_telegram_bot_token,
)
from backend.app.db import build_engine, create_schema
from backend.app.modules.analysis.batch_service import (
    AnalysisBatchReport,
    analyze_pending_publications,
)
from backend.app.modules.sources.collection_service import collect_enabled_sources
from backend.app.modules.users.telegram_digest import deliver_pending_telegram_digests


DEFAULT_COLLECTION_INTERVAL_SECONDS = 15 * 60


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=REPOSITORY_ROOT / ".local/live.sqlite3")
    parser.add_argument(
        "--interval",
        type=int,
        default=DEFAULT_COLLECTION_INTERVAL_SECONDS,
        help="Seconds between collection runs (default: 900 / 15 minutes)",
    )
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    if args.interval < 60:
        parser.error("--interval must be at least 60 seconds")

    engine = build_engine(f"sqlite:///{args.db.resolve()}")
    create_schema(engine)
    try:
        while True:
            with Session(engine, expire_on_commit=False) as session:
                analysis_reports: list[AnalysisBatchReport] = []

                def analyze_after_source() -> None:
                    analysis_reports.append(
                        analyze_pending_publications(
                            session,
                            limit=get_auto_analysis_batch_size(),
                            min_content_chars=get_auto_analysis_min_content_chars(),
                        )
                    )

                report = collect_enabled_sources(
                    session,
                    after_source=analyze_after_source,
                )
                if not analysis_reports:
                    analyze_after_source()
                analysis_report = _combine_analysis_reports(analysis_reports)
                telegram_report = deliver_pending_telegram_digests(
                    session,
                    bot_token=get_telegram_bot_token(),
                )
            print(
                json.dumps(
                    {
                        "collection": report.model_dump(mode="json"),
                        "analysis": analysis_report.as_dict(),
                        "telegram": telegram_report.as_dict(),
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
            if args.once:
                return
            time.sleep(args.interval)
    except KeyboardInterrupt:
        return
    finally:
        engine.dispose()


def _combine_analysis_reports(
    reports: list[AnalysisBatchReport],
) -> AnalysisBatchReport:
    return AnalysisBatchReport(
        pending=reports[-1].pending,
        attempted=sum(report.attempted for report in reports),
        created=sum(report.created for report in reports),
        skipped_short=reports[-1].skipped_short,
        failed=sum(report.failed for report in reports),
        failures=tuple(
            failure
            for report in reports
            for failure in report.failures
        ),
    )


if __name__ == "__main__":
    main()
