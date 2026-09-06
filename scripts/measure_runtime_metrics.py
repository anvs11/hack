#!/usr/bin/env python3
"""Measure local API response time and observed publication collection lag."""

from __future__ import annotations

import argparse
import json
import math
import platform
import sqlite3
import time
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE = ROOT / ".local" / "live.sqlite3"
DEFAULT_OUTPUT_DIR = ROOT / "data" / "eval" / "results" / "runtime-smoke-v1"
API_TARGET_SECONDS = 1.0
COLLECTION_TARGET_SECONDS = {
    "rss": 15 * 60,
    "telegram": 15 * 60,
    "regulator": 60 * 60,
}
API_SCENARIOS = {
    "feed": {"limit": 20},
    "search": {"q": "правительство", "limit": 20},
    "filters": {
        "category": "regulation",
        "proposed_priority": "high",
        "limit": 20,
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--requests", type=int, default=30)
    parser.add_argument("--warmup", type=int, default=3)
    parser.add_argument("--timeout-seconds", type=float, default=5.0)
    parser.add_argument(
        "--published-since",
        default=None,
        help="ISO-8601 T0; exclude publications created before the observation window",
    )
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    return parser.parse_args()


def percentile(values: list[float], percent: float) -> float | None:
    """Return a nearest-rank percentile for a non-empty numeric sample."""

    if not values:
        return None
    if not 0 < percent <= 100:
        raise ValueError("percent must be in (0, 100]")
    ordered = sorted(values)
    index = max(0, math.ceil(percent / 100 * len(ordered)) - 1)
    return ordered[index]


def summarize_durations(
    values: list[float],
    target_seconds: float,
    *,
    inclusive: bool = False,
) -> dict[str, Any]:
    within_target = sum(
        value <= target_seconds if inclusive else value < target_seconds
        for value in values
    )
    return {
        "sample_count": len(values),
        "median_seconds": _rounded(percentile(values, 50)),
        "p95_seconds": _rounded(percentile(values, 95)),
        "max_seconds": _rounded(max(values) if values else None),
        "target_seconds": target_seconds,
        "target_operator": "less_than_or_equal" if inclusive else "less_than",
        "within_target_count": within_target,
        "within_target_rate": _rate(within_target, len(values)),
        "orientation_met_in_this_sample": bool(values) and within_target == len(values),
    }


def parse_datetime(value: str) -> datetime:
    normalized = value.strip().replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def measure_api(
    base_url: str,
    *,
    requests: int,
    warmup: int,
    timeout_seconds: float,
) -> dict[str, Any]:
    if requests <= 0 or warmup < 0 or timeout_seconds <= 0:
        raise ValueError("requests and timeout-seconds must be positive; warmup cannot be negative")

    results: dict[str, Any] = {}
    for name, query in API_SCENARIOS.items():
        url = f"{base_url.rstrip('/')}/api/publications?{urlencode(query)}"
        for _ in range(warmup):
            _request_json(url, timeout_seconds)

        durations: list[float] = []
        errors: list[str] = []
        for _ in range(requests):
            started = time.perf_counter()
            try:
                _request_json(url, timeout_seconds)
                durations.append(time.perf_counter() - started)
            except Exception as error:
                errors.append(f"{type(error).__name__}: {error}")
        results[name] = {
            "path": f"/api/publications?{urlencode(query)}",
            "successful_requests": len(durations),
            "failed_requests": len(errors),
            "errors": errors[:3],
            **summarize_durations(durations, API_TARGET_SECONDS),
        }
    return results


def measure_collection_lag(
    database: Path,
    *,
    published_since: str | None = None,
) -> dict[str, Any]:
    connection = sqlite3.connect(database)
    connection.row_factory = sqlite3.Row
    try:
        primary_rows = connection.execute(
            """
            SELECT publications.id, publications.published_at,
                   publications.payload_json, sources.type AS source_type
            FROM publications
            JOIN sources ON sources.id = publications.source_id
            """
        ).fetchall()
        reference_rows = connection.execute(
            """
            SELECT publication_source_references.id,
                   publication_source_references.published_at,
                   publication_source_references.collected_at,
                   sources.type AS source_type
            FROM publication_source_references
            JOIN sources ON sources.id = publication_source_references.source_id
            """
        ).fetchall()
    finally:
        connection.close()

    observations: list[tuple[str, float]] = []
    missing_collected_at = 0
    invalid_timestamp = 0
    negative_lag = 0
    unsupported_source_type = 0
    excluded_before_window = 0
    observation_start = parse_datetime(published_since) if published_since else None

    candidates: list[tuple[str, str, str | None]] = []
    for row in primary_rows:
        try:
            payload = json.loads(row["payload_json"])
        except (TypeError, json.JSONDecodeError):
            invalid_timestamp += 1
            continue
        candidates.append((row["source_type"], row["published_at"], payload.get("collected_at")))
    candidates.extend(
        (row["source_type"], row["published_at"], row["collected_at"])
        for row in reference_rows
    )

    for source_type, published_at, collected_at in candidates:
        if source_type not in COLLECTION_TARGET_SECONDS:
            unsupported_source_type += 1
            continue
        if not isinstance(collected_at, str) or not collected_at:
            missing_collected_at += 1
            continue
        try:
            published = parse_datetime(published_at)
            if observation_start is not None and published < observation_start:
                excluded_before_window += 1
                continue
            lag = (parse_datetime(collected_at) - published).total_seconds()
        except (TypeError, ValueError):
            invalid_timestamp += 1
            continue
        if lag < 0:
            negative_lag += 1
            continue
        observations.append((source_type, lag))

    grouped: dict[str, list[float]] = defaultdict(list)
    for source_type, lag in observations:
        grouped[source_type].append(lag)

    return {
        "scope": "all stored primary publications and folded source references",
        "published_since": observation_start.isoformat() if observation_start else None,
        "interpretation": (
            "Historical backfill is included. This is an observed lag diagnostic, "
            "not a steady-state scheduler SLA measurement."
        ),
        "candidate_count": len(candidates),
        "valid_observation_count": len(observations),
        "missing_collected_at_count": missing_collected_at,
        "invalid_timestamp_count": invalid_timestamp,
        "negative_lag_count": negative_lag,
        "unsupported_source_type_count": unsupported_source_type,
        "excluded_before_window_count": excluded_before_window,
        "by_source_type": {
            source_type: summarize_durations(
                values,
                COLLECTION_TARGET_SECONDS[source_type],
                inclusive=True,
            )
            for source_type, values in sorted(grouped.items())
        },
    }


def build_report(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "measurement": {
            "kind": "runtime_smoke",
            "created_at": datetime.now(UTC).isoformat(),
            "environment": {
                "python": platform.python_version(),
                "platform": platform.platform(),
                "api_base_url": args.api_base_url,
                "database": _display_path(args.database.resolve()),
            },
            "sla_claim_allowed": False,
            "reason": (
                "Sequential local requests and historical stored items do not measure "
                "production load or a full steady-state observation window."
            ),
        },
        "orientations": {
            "api_response_seconds": API_TARGET_SECONDS,
            "publication_to_feed_seconds": COLLECTION_TARGET_SECONDS,
        },
        "api": measure_api(
            args.api_base_url,
            requests=args.requests,
            warmup=args.warmup,
            timeout_seconds=args.timeout_seconds,
        ),
        "collection_lag": measure_collection_lag(
            args.database.resolve(),
            published_since=args.published_since,
        ),
    }


def write_report(report: dict[str, Any], output_dir: Path, args: argparse.Namespace) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    api_lines = "\n".join(
        f"- `{name}`: median {value['median_seconds']} s, p95 {value['p95_seconds']} s, "
        f"max {value['max_seconds']} s; {value['successful_requests']} successful, "
        f"{value['failed_requests']} failed."
        for name, value in report["api"].items()
    )
    collection_lines = "\n".join(
        f"- `{name}`: median {value['median_seconds']} s, p95 {value['p95_seconds']} s, "
        f"within orientation {value['within_target_count']}/{value['sample_count']}."
        for name, value in report["collection_lag"]["by_source_type"].items()
    ) or "- No valid observations."
    command = (
        ".venv/bin/python scripts/measure_runtime_metrics.py "
        f"--api-base-url {args.api_base_url} --database {_display_path(args.database.resolve())} "
        f"--requests {args.requests} --warmup {args.warmup} "
        f"--output-dir {_display_path(output_dir.resolve())}"
    )
    if args.published_since:
        command += f" --published-since {args.published_since}"
    markdown = f"""# Runtime metrics smoke

## API response time

{api_lines}

## Publication-to-collection lag

{collection_lines}

Historical backfill is included, so collection lag is diagnostic only. This run is
also sequential and local. It does not establish a production SLA.

## Reproduce

```bash
{command}
```
"""
    (output_dir / "REPORT.md").write_text(markdown, encoding="utf-8")


def _request_json(url: str, timeout_seconds: float) -> Any:
    request = Request(url, headers={"Accept": "application/json"})
    with urlopen(request, timeout=timeout_seconds) as response:
        if response.status != 200:
            raise ValueError(f"unexpected HTTP status {response.status}")
        return json.loads(response.read().decode("utf-8"))


def _rounded(value: float | None) -> float | None:
    return round(value, 6) if value is not None else None


def _rate(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 6) if denominator else None


def _display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def main() -> int:
    args = parse_args()
    report = build_report(args)
    write_report(report, args.output_dir, args)
    print(
        json.dumps(
            {"api": report["api"], "collection_lag": report["collection_lag"]},
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
