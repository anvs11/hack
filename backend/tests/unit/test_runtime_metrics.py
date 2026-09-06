from datetime import UTC, datetime

import pytest

from scripts.measure_runtime_metrics import parse_datetime, percentile, summarize_durations
from scripts.evaluate_live_analysis import _percentile as live_percentile


def test_percentile_uses_nearest_rank() -> None:
    values = [0.01, 0.02, 0.03, 0.04, 0.05]

    assert percentile(values, 50) == 0.03
    assert percentile(values, 95) == 0.05
    assert percentile([], 95) is None


def test_percentile_rejects_invalid_percent() -> None:
    with pytest.raises(ValueError, match="percent must be"):
        percentile([1.0], 0)


def test_duration_summary_keeps_target_and_sample_scope() -> None:
    summary = summarize_durations([0.1, 0.2, 1.2], 1.0)

    assert summary["sample_count"] == 3
    assert summary["median_seconds"] == 0.2
    assert summary["p95_seconds"] == 1.2
    assert summary["within_target_count"] == 2
    assert summary["within_target_rate"] == 0.666667
    assert summary["target_operator"] == "less_than"
    assert summary["orientation_met_in_this_sample"] is False


def test_duration_summary_can_use_inclusive_target() -> None:
    summary = summarize_durations([899.0, 900.0, 901.0], 900.0, inclusive=True)

    assert summary["within_target_count"] == 2
    assert summary["target_operator"] == "less_than_or_equal"


def test_parse_datetime_normalizes_utc() -> None:
    assert parse_datetime("2026-09-06T12:00:00Z") == datetime(
        2026,
        9,
        6,
        12,
        tzinfo=UTC,
    )
    assert parse_datetime("2026-09-06T15:00:00+03:00") == datetime(
        2026,
        9,
        6,
        12,
        tzinfo=UTC,
    )


def test_live_evaluation_percentile_handles_empty_and_ordered_values() -> None:
    assert live_percentile([], 95) is None
    assert live_percentile([12.0, 8.0, 14.0], 50) == 12.0
    assert live_percentile([12.0, 8.0, 14.0], 95) == 14.0
