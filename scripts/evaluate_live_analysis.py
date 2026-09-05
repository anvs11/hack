#!/usr/bin/env python3
"""Measure live LLM plumbing without claiming model quality."""

from __future__ import annotations

import argparse
import json
import re
import signal
import sys
import time
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from types import FrameType
from typing import Iterator

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from backend.app.modules.analysis.analyzers import LiveLLMAnalyzer  # noqa: E402
from backend.app.modules.publications.models import Publication  # noqa: E402


DEFAULT_DATABASE_URL = f"sqlite:///{ROOT / '.local' / 'live.sqlite3'}"
DEFAULT_OUTPUT_DIR = ROOT / "data" / "eval" / "results" / "live-llm-smoke-v1"


@dataclass(frozen=True)
class EvaluationRow:
    publication_id: str
    input_hash: str
    input_chars: int
    status: str
    latency_seconds: float
    summary_chars: int | None
    compression_ratio: float | None
    summary_sentences: int | None
    evidence_quotes: int | None
    grounded_quotes: int | None
    error: str | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", default=DEFAULT_DATABASE_URL)
    parser.add_argument("--model-id", default="Qwen/Qwen3.5-0.8B")
    parser.add_argument("--cache-dir", type=Path, default=ROOT / ".local" / "huggingface")
    parser.add_argument("--limit", type=int, default=3)
    parser.add_argument("--timeout-seconds", type=int, default=120)
    parser.add_argument("--max-input-chars", type=int, default=12_000)
    parser.add_argument("--max-new-tokens", type=int, default=512)
    parser.add_argument("--allow-download", action="store_true")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    return parser.parse_args()


def evaluate(args: argparse.Namespace) -> dict:
    if args.limit <= 0 or args.timeout_seconds <= 0:
        raise ValueError("limit and timeout-seconds must be positive")
    engine = create_engine(args.database_url)
    with Session(engine) as session:
        publications = list(
            session.scalars(
                select(Publication)
                .order_by(Publication.published_at.desc(), Publication.id)
                .limit(args.limit)
            )
        )
    engine.dispose()
    if not publications:
        raise ValueError("database contains no publications")

    analyzer = LiveLLMAnalyzer(
        model_id=args.model_id,
        cache_dir=args.cache_dir,
        download_allowed=args.allow_download,
        max_input_chars=args.max_input_chars,
        max_new_tokens=args.max_new_tokens,
    )
    rows = [_evaluate_one(analyzer, row, args.timeout_seconds) for row in publications]
    successful = [row for row in rows if row.status == "success"]
    return {
        "measurement": {
            "kind": "plumbing_smoke",
            "quality_claim_allowed": False,
            "reason": "No independent human labels were used.",
            "created_at": datetime.now(UTC).isoformat(),
            "model": args.model_id,
            "limit": args.limit,
            "timeout_seconds": args.timeout_seconds,
            "max_input_chars": args.max_input_chars,
            "max_new_tokens": args.max_new_tokens,
        },
        "aggregate": {
            "attempted": len(rows),
            "successful": len(successful),
            "timed_out": sum(row.status == "timeout" for row in rows),
            "failed": sum(row.status == "error" for row in rows),
            "mean_latency_seconds": _mean([row.latency_seconds for row in successful]),
            "mean_compression_ratio": _mean(
                [row.compression_ratio for row in successful if row.compression_ratio is not None]
            ),
            "summaries_with_3_to_5_sentences": sum(
                row.summary_sentences is not None and 3 <= row.summary_sentences <= 5
                for row in successful
            ),
            "all_evidence_grounded": bool(successful)
            and all(row.evidence_quotes == row.grounded_quotes for row in successful),
        },
        "rows": [asdict(row) for row in rows],
    }


def _evaluate_one(
    analyzer: LiveLLMAnalyzer,
    publication: Publication,
    timeout_seconds: int,
) -> EvaluationRow:
    payload = json.loads(publication.payload_json)
    content = payload["content"]
    started = time.perf_counter()
    try:
        with _deadline(timeout_seconds):
            draft = analyzer.analyze(
                publication_id=publication.id,
                title=payload["title"],
                content=content,
            )
        latency = time.perf_counter() - started
        grounded = sum(
            _normalize_text(evidence.quote) in _normalize_text(content)
            for evidence in draft.evidence
            if _normalize_text(evidence.quote)
        )
        summary_chars = len(draft.summary)
        return EvaluationRow(
            publication_id=publication.id,
            input_hash=publication.content_hash,
            input_chars=len(content),
            status="success",
            latency_seconds=round(latency, 3),
            summary_chars=summary_chars,
            compression_ratio=round(summary_chars / max(len(content), 1), 4),
            summary_sentences=_sentence_count(draft.summary),
            evidence_quotes=len(draft.evidence),
            grounded_quotes=grounded,
            error=None,
        )
    except Exception as error:
        latency = time.perf_counter() - started
        status = "timeout" if _caused_by_timeout(error) else "error"
        return EvaluationRow(
            publication_id=publication.id,
            input_hash=publication.content_hash,
            input_chars=len(content),
            status=status,
            latency_seconds=round(latency, 3),
            summary_chars=None,
            compression_ratio=None,
            summary_sentences=None,
            evidence_quotes=None,
            grounded_quotes=None,
            error=f"{type(error).__name__}: {error}",
        )


@contextmanager
def _deadline(seconds: int) -> Iterator[None]:
    def timeout_handler(_signum: int, _frame: FrameType | None) -> None:
        raise TimeoutError(f"inference exceeded {seconds} seconds")

    previous = signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm(seconds)
    try:
        yield
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous)


def _caused_by_timeout(error: BaseException) -> bool:
    current: BaseException | None = error
    while current is not None:
        if isinstance(current, TimeoutError):
            return True
        current = current.__cause__ or current.__context__
    return False


def _sentence_count(value: str) -> int:
    return len(re.findall(r"[.!?]+(?:\s|$)", value.strip()))


def _normalize_text(value: str) -> str:
    return " ".join(value.split()).casefold()


def _mean(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 4) if values else None


def write_report(report: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    aggregate = report["aggregate"]
    measurement = report["measurement"]
    markdown = f"""# Live LLM plumbing smoke

- Model: `{measurement['model']}`
- Attempted: {aggregate['attempted']}
- Successful: {aggregate['successful']}
- Timed out: {aggregate['timed_out']}
- Failed: {aggregate['failed']}
- Mean latency, successful only: {aggregate['mean_latency_seconds']}
- Mean summary/input character ratio: {aggregate['mean_compression_ratio']}

This run validates wiring and runtime behavior only. `quality_claim_allowed=false`;
there are no independent human labels for factuality, category or priority.

Reproduce from the repository root:

```bash
.venv/bin/python scripts/evaluate_live_analysis.py
```
"""
    (output_dir / "REPORT.md").write_text(markdown, encoding="utf-8")


def main() -> int:
    args = parse_args()
    report = evaluate(args)
    write_report(report, args.output_dir)
    print(json.dumps(report["aggregate"], ensure_ascii=False))
    return 0 if report["aggregate"]["successful"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
