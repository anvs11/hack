import pytest

from scripts.evaluate_analysis import evaluate


def _labels(*items: dict) -> dict:
    return {
        "dataset_id": "unit-test",
        "purpose": "quality_benchmark",
        "frozen_at": "2026-09-04T00:00:00Z",
        "independent_labels": True,
        "quality_claim_allowed": True,
        "items": list(items),
    }


def _label(publication_id: str, category: str, priority: str) -> dict:
    return {
        "publication_id": publication_id,
        "expected_category": category,
        "expected_priority": priority,
        "label_source": "independent_manual",
        "annotator_id": "unit-test-annotator",
        "notes": None,
    }


def _prediction(
    publication_id: str,
    category: str,
    priority: str,
    quote: str,
) -> dict:
    return {
        "publication_id": publication_id,
        "version": 1,
        "category": category,
        "proposed_priority": priority,
        "evidence": [{"claim": "test", "quote": quote}],
    }


def test_evaluation_counts_classification_and_critical_guardrail() -> None:
    report, rows = evaluate(
        _labels(
            _label("pub-1", "regulation", "critical"),
            _label("pub-2", "trend", "medium"),
        ),
        [
            _prediction("pub-1", "regulation", "low", "важный факт"),
            _prediction("pub-2", "trend", "medium", "другой факт"),
        ],
        [
            {"id": "pub-1", "content": "Текст содержит важный факт."},
            {"id": "pub-2", "content": "Здесь есть другой факт."},
        ],
    )

    assert report["priority"]["accuracy"] == 0.5
    assert report["priority"]["macro_f1"] == 0.333333
    assert report["priority"]["confusion_matrix"]["critical"]["low"] == 1
    assert report["critical_guardrail"] == {
        "critical_label_count": 1,
        "critical_to_low_count": 1,
    }
    assert report["category"]["accuracy"] == 1.0
    assert all(row.all_evidence_grounded for row in rows)


def test_evaluation_separates_invalid_json_schema_and_evidence() -> None:
    report, rows = evaluate(
        _labels(
            _label("pub-1", "regulation", "high"),
            _label("pub-2", "trend", "low"),
            _label("pub-3", "trend", "low"),
        ),
        [
            {"publication_id": "pub-1", "output": "not-json"},
            {
                "publication_id": "pub-2",
                "output": {
                    "publication_id": "pub-2",
                    "version": 1,
                    "category": "wrong",
                    "proposed_priority": "low",
                    "evidence": [],
                },
            },
            _prediction("pub-3", "trend", "low", "отсутствующая цитата"),
        ],
        [
            {"id": "pub-1", "content": "Первый текст."},
            {"id": "pub-2", "content": "Второй текст."},
            {"id": "pub-3", "content": "Третий текст."},
        ],
    )

    assert report["format_validation"]["valid_json_count"] == 2
    assert report["format_validation"]["valid_schema_count"] == 1
    assert report["coverage"]["missing_or_invalid_prediction_count"] == 2
    assert report["evidence"]["grounded_quote_count"] == 0
    assert rows[0].error.startswith("invalid_json")
    assert rows[1].error.startswith("invalid_schema")
    assert rows[2].all_evidence_grounded is False


def test_latest_prediction_version_is_evaluated() -> None:
    report, _rows = evaluate(
        _labels(_label("pub-1", "trend", "high")),
        [
            _prediction("pub-1", "trend", "low", "факт"),
            {
                **_prediction("pub-1", "trend", "high", "факт"),
                "version": 2,
            },
        ],
        [{"id": "pub-1", "content": "Факт подтверждён."}],
    )

    assert report["priority"]["accuracy"] == 1.0


def test_quality_claim_requires_independent_labels() -> None:
    labels = _labels(_label("pub-1", "trend", "low"))
    labels["independent_labels"] = False

    with pytest.raises(ValueError, match="quality claims require independent labels"):
        evaluate(labels, [], [{"id": "pub-1", "content": "Текст."}])


def test_independent_dataset_rejects_replay_labels() -> None:
    labels = _labels(_label("pub-1", "trend", "low"))
    labels["items"][0]["label_source"] = "replay_fixture"
    labels["items"][0]["annotator_id"] = None

    with pytest.raises(ValueError, match="non-independent label"):
        evaluate(labels, [], [{"id": "pub-1", "content": "Текст."}])


def test_invalid_version_does_not_break_duplicate_selection() -> None:
    invalid = _prediction("pub-1", "trend", "low", "факт")
    invalid["version"] = "latest"
    report, rows = evaluate(
        _labels(_label("pub-1", "trend", "high")),
        [invalid, _prediction("pub-1", "trend", "high", "факт")],
        [{"id": "pub-1", "content": "Факт подтверждён."}],
    )

    assert report["priority"]["accuracy"] == 1.0
    assert rows[0].valid_schema is True
