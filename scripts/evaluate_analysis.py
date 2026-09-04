#!/usr/bin/env python3
"""Deterministic offline evaluation for structured publication analyses."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import shlex
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LABELS = ROOT / "data" / "eval" / "smoke-labels-v1.json"
DEFAULT_PREDICTIONS = ROOT / "data" / "seed" / "replay-analyses.json"
DEFAULT_PUBLICATIONS = ROOT / "data" / "seed" / "publications.json"
DEFAULT_OUTPUT_DIR = ROOT / "data" / "eval" / "results" / "seed-replay-smoke-v1"

PRIORITIES = ("critical", "high", "medium", "low", "unknown")
CATEGORIES = ("regulation", "reputation", "competitor", "trend", "unknown")


@dataclass(frozen=True)
class EvaluationRow:
    publication_id: str
    valid_json: bool
    valid_schema: bool
    expected_category: str
    predicted_category: str | None
    category_correct: bool
    expected_priority: str
    predicted_priority: str | None
    priority_correct: bool
    critical_to_low: bool
    evidence_quotes: int
    grounded_quotes: int
    all_evidence_grounded: bool
    error: str | None


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def evaluate(
    labels_document: dict[str, Any],
    predictions_document: list[Any],
    publications_document: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[EvaluationRow]]:
    labels = _validated_labels(labels_document)
    if not isinstance(predictions_document, list):
        raise ValueError("predictions must be a JSON array")
    publications = _publication_content(publications_document)
    parsed_predictions = [
        _parse_prediction(item, index)
        for index, item in enumerate(predictions_document)
    ]
    prediction_by_publication = _latest_predictions(parsed_predictions)

    rows = [
        _evaluate_row(label, prediction_by_publication.get(label["publication_id"]), publications)
        for label in labels
    ]
    valid_json_count = sum(prediction["valid_json"] for prediction in parsed_predictions)
    valid_schema_count = sum(prediction["valid_schema"] for prediction in parsed_predictions)
    matched_rows = [row for row in rows if row.valid_schema]

    report = {
        "dataset": {
            "dataset_id": labels_document["dataset_id"],
            "purpose": labels_document["purpose"],
            "frozen_at": labels_document["frozen_at"],
            "independent_labels": labels_document["independent_labels"],
            "quality_claim_allowed": labels_document["quality_claim_allowed"],
            "label_count": len(labels),
        },
        "format_validation": {
            "predictions_received": len(parsed_predictions),
            "valid_json_count": valid_json_count,
            "valid_json_rate": _rate(valid_json_count, len(parsed_predictions)),
            "valid_schema_count": valid_schema_count,
            "valid_schema_rate": _rate(valid_schema_count, len(parsed_predictions)),
        },
        "coverage": {
            "matched_prediction_count": len(matched_rows),
            "missing_or_invalid_prediction_count": len(rows) - len(matched_rows),
            "unexpected_prediction_ids": sorted(
                publication_id
                for publication_id in prediction_by_publication
                if publication_id not in {label["publication_id"] for label in labels}
            ),
        },
        "priority": _classification_metrics(
            [row.expected_priority for row in matched_rows],
            [row.predicted_priority for row in matched_rows],
            PRIORITIES,
        ),
        "category": _classification_metrics(
            [row.expected_category for row in matched_rows],
            [row.predicted_category for row in matched_rows],
            CATEGORIES,
        ),
        "critical_guardrail": {
            "critical_label_count": sum(row.expected_priority == "critical" for row in rows),
            "critical_to_low_count": sum(row.critical_to_low for row in rows),
        },
        "evidence": _evidence_metrics(matched_rows),
        "summary_factuality": {
            "status": "not_measured",
            "reason": (
                "Substring grounding of evidence quotes does not prove that every "
                "summary claim is factually supported. Independent human annotation is required."
            ),
        },
    }
    return report, rows


def _validated_labels(document: dict[str, Any]) -> list[dict[str, Any]]:
    required = {
        "dataset_id",
        "purpose",
        "frozen_at",
        "independent_labels",
        "quality_claim_allowed",
        "items",
    }
    if not isinstance(document, dict) or not required.issubset(document):
        raise ValueError("labels document is missing required metadata")
    if not isinstance(document["dataset_id"], str) or not document["dataset_id"]:
        raise ValueError("labels dataset_id must be a non-empty string")
    if not isinstance(document["frozen_at"], str) or not document["frozen_at"]:
        raise ValueError("labels frozen_at must be a non-empty string")
    if document["purpose"] not in {"plumbing_smoke", "quality_benchmark"}:
        raise ValueError("labels purpose is invalid")
    if not isinstance(document["independent_labels"], bool):
        raise ValueError("independent_labels must be boolean")
    if not isinstance(document["quality_claim_allowed"], bool):
        raise ValueError("quality_claim_allowed must be boolean")
    if document["quality_claim_allowed"] and not document["independent_labels"]:
        raise ValueError("quality claims require independent labels")
    if document["purpose"] == "plumbing_smoke" and document["quality_claim_allowed"]:
        raise ValueError("plumbing smoke cannot allow quality claims")
    items = document["items"]
    if not isinstance(items, list) or not items:
        raise ValueError("labels items must be a non-empty array")

    ids: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("each label must be an object")
        publication_id = item.get("publication_id")
        if not isinstance(publication_id, str) or not publication_id:
            raise ValueError("each label needs publication_id")
        if publication_id in ids:
            raise ValueError(f"duplicate label for {publication_id}")
        if item.get("expected_priority") not in PRIORITIES:
            raise ValueError(f"invalid priority label for {publication_id}")
        if item.get("expected_category") not in CATEGORIES:
            raise ValueError(f"invalid category label for {publication_id}")
        label_source = item.get("label_source")
        if label_source not in {"independent_manual", "replay_fixture"}:
            raise ValueError(f"invalid label source for {publication_id}")
        annotator_id = item.get("annotator_id")
        if label_source == "independent_manual" and (
            not isinstance(annotator_id, str) or not annotator_id.strip()
        ):
            raise ValueError(f"independent label needs annotator_id for {publication_id}")
        if document["independent_labels"] and label_source != "independent_manual":
            raise ValueError(f"independent dataset has non-independent label for {publication_id}")
        ids.add(publication_id)
    return items


def _publication_content(document: list[dict[str, Any]]) -> dict[str, str]:
    if not isinstance(document, list):
        raise ValueError("publications must be a JSON array")
    result: dict[str, str] = {}
    for item in document:
        publication_id = item.get("id")
        content = item.get("content")
        if not isinstance(publication_id, str) or not isinstance(content, str):
            raise ValueError("each publication needs string id and content")
        if publication_id in result:
            raise ValueError(f"duplicate publication {publication_id}")
        result[publication_id] = content
    return result


def _parse_prediction(item: Any, index: int) -> dict[str, Any]:
    envelope_id = item.get("publication_id") if isinstance(item, dict) else None
    output = item.get("output") if isinstance(item, dict) and "output" in item else item
    if isinstance(output, str):
        try:
            output = json.loads(output)
        except json.JSONDecodeError as error:
            return {
                "publication_id": envelope_id or f"invalid-{index}",
                "version": 0,
                "valid_json": False,
                "valid_schema": False,
                "output": None,
                "error": f"invalid_json: {error.msg}",
            }
    if not isinstance(output, dict):
        return {
            "publication_id": envelope_id or f"invalid-{index}",
            "version": 0,
            "valid_json": False,
            "valid_schema": False,
            "output": None,
            "error": "invalid_json: output is not an object",
        }

    publication_id = envelope_id or output.get("publication_id")
    schema_error = _prediction_schema_error(output, publication_id)
    if (
        schema_error is None
        and envelope_id
        and output.get("publication_id") not in (None, envelope_id)
    ):
        schema_error = "invalid_schema: envelope and output publication_id differ"
    raw_version = output.get("version", 0)
    sortable_version = raw_version if type(raw_version) is int and raw_version >= 0 else 0
    return {
        "publication_id": publication_id or f"invalid-{index}",
        "version": sortable_version,
        "valid_json": True,
        "valid_schema": schema_error is None,
        "output": output,
        "error": schema_error,
    }


def _prediction_schema_error(output: dict[str, Any], publication_id: Any) -> str | None:
    if not isinstance(publication_id, str) or not publication_id:
        return "invalid_schema: publication_id is required"
    if output.get("proposed_priority") not in PRIORITIES:
        return "invalid_schema: proposed_priority is invalid"
    if output.get("category") not in CATEGORIES:
        return "invalid_schema: category is invalid"
    evidence = output.get("evidence")
    if not isinstance(evidence, list):
        return "invalid_schema: evidence must be an array"
    if any(
        not isinstance(item, dict) or not isinstance(item.get("quote"), str)
        for item in evidence
    ):
        return "invalid_schema: every evidence item needs a string quote"
    version = output.get("version", 0)
    if type(version) is not int or version < 0:
        return "invalid_schema: version must be a non-negative integer"
    return None


def _latest_predictions(predictions: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    for prediction in predictions:
        publication_id = prediction["publication_id"]
        current = latest.get(publication_id)
        if current is None or prediction["version"] > current["version"]:
            latest[publication_id] = prediction
    return latest


def _evaluate_row(
    label: dict[str, Any],
    prediction: dict[str, Any] | None,
    publications: dict[str, str],
) -> EvaluationRow:
    publication_id = label["publication_id"]
    if publication_id not in publications:
        raise ValueError(f"missing publication content for {publication_id}")
    if prediction is None:
        return _empty_row(label, "missing_prediction")
    if not prediction["valid_schema"]:
        return _empty_row(
            label,
            prediction["error"],
            valid_json=prediction["valid_json"],
        )

    output = prediction["output"]
    quotes = [item["quote"] for item in output["evidence"]]
    content = _normalize_text(publications[publication_id])
    grounded = sum(
        bool(_normalize_text(quote)) and _normalize_text(quote) in content
        for quote in quotes
    )
    predicted_priority = output["proposed_priority"]
    predicted_category = output["category"]
    return EvaluationRow(
        publication_id=publication_id,
        valid_json=True,
        valid_schema=True,
        expected_category=label["expected_category"],
        predicted_category=predicted_category,
        category_correct=predicted_category == label["expected_category"],
        expected_priority=label["expected_priority"],
        predicted_priority=predicted_priority,
        priority_correct=predicted_priority == label["expected_priority"],
        critical_to_low=(
            label["expected_priority"] == "critical" and predicted_priority == "low"
        ),
        evidence_quotes=len(quotes),
        grounded_quotes=grounded,
        all_evidence_grounded=bool(quotes) and grounded == len(quotes),
        error=None,
    )


def _empty_row(
    label: dict[str, Any],
    error: str,
    *,
    valid_json: bool = False,
) -> EvaluationRow:
    return EvaluationRow(
        publication_id=label["publication_id"],
        valid_json=valid_json,
        valid_schema=False,
        expected_category=label["expected_category"],
        predicted_category=None,
        category_correct=False,
        expected_priority=label["expected_priority"],
        predicted_priority=None,
        priority_correct=False,
        critical_to_low=False,
        evidence_quotes=0,
        grounded_quotes=0,
        all_evidence_grounded=False,
        error=error,
    )


def _classification_metrics(
    expected: list[str],
    predicted: list[str | None],
    order: tuple[str, ...],
) -> dict[str, Any]:
    pairs = [(actual, guess) for actual, guess in zip(expected, predicted) if guess is not None]
    observed = {value for pair in pairs for value in pair}
    classes = [value for value in order if value in observed]
    matrix = {
        actual: {guess: sum(pair == (actual, guess) for pair in pairs) for guess in order}
        for actual in order
    }
    correct = sum(actual == guess for actual, guess in pairs)
    f1_by_class: dict[str, float] = {}
    for value in classes:
        true_positive = sum(actual == value and guess == value for actual, guess in pairs)
        false_positive = sum(actual != value and guess == value for actual, guess in pairs)
        false_negative = sum(actual == value and guess != value for actual, guess in pairs)
        denominator = 2 * true_positive + false_positive + false_negative
        f1_by_class[value] = _rounded((2 * true_positive / denominator) if denominator else 0.0)
    return {
        "evaluated_count": len(pairs),
        "accuracy": _rate(correct, len(pairs)),
        "macro_f1": _rounded(sum(f1_by_class.values()) / len(classes)) if classes else None,
        "evaluated_classes": classes,
        "f1_by_class": f1_by_class,
        "confusion_matrix": matrix,
    }


def _evidence_metrics(rows: list[EvaluationRow]) -> dict[str, Any]:
    quote_count = sum(row.evidence_quotes for row in rows)
    grounded_count = sum(row.grounded_quotes for row in rows)
    all_grounded = sum(row.all_evidence_grounded for row in rows)
    empty_evidence = sum(row.evidence_quotes == 0 for row in rows)
    return {
        "evaluated_prediction_count": len(rows),
        "evidence_quote_count": quote_count,
        "grounded_quote_count": grounded_count,
        "grounded_quote_rate": _rate(grounded_count, quote_count),
        "all_quotes_grounded_prediction_count": all_grounded,
        "all_quotes_grounded_prediction_rate": _rate(all_grounded, len(rows)),
        "empty_evidence_prediction_count": empty_evidence,
    }


def _normalize_text(value: str) -> str:
    return " ".join(value.split()).casefold()


def _rate(numerator: int, denominator: int) -> float | None:
    return _rounded(numerator / denominator) if denominator else None


def _rounded(value: float) -> float:
    return round(value, 6)


def write_artifacts(
    output_dir: Path,
    report: dict[str, Any],
    rows: list[EvaluationRow],
    *,
    labels_path: Path,
    predictions_path: Path,
    publications_path: Path,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    report_with_inputs = {
        "inputs": {
            "labels": _display_path(labels_path),
            "labels_sha256": file_sha256(labels_path),
            "predictions": _display_path(predictions_path),
            "predictions_sha256": file_sha256(predictions_path),
            "publications": _display_path(publications_path),
            "publications_sha256": file_sha256(publications_path),
        },
        "reproduction_command": _reproduction_command(
            labels_path,
            predictions_path,
            publications_path,
            output_dir,
        ),
        **report,
    }
    (output_dir / "report.json").write_text(
        json.dumps(report_with_inputs, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    with (output_dir / "rows.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(asdict(rows[0]).keys()))
        writer.writeheader()
        writer.writerows(asdict(row) for row in rows)
    (output_dir / "REPORT.md").write_text(
        _markdown_report(report_with_inputs),
        encoding="utf-8",
    )


def _markdown_report(report: dict[str, Any]) -> str:
    dataset = report["dataset"]
    priority = report["priority"]
    category = report["category"]
    evidence = report["evidence"]
    guardrail = report["critical_guardrail"]
    return f"""# Technical eval: {dataset['dataset_id']}

## Статус результата

**Факт:** это `{dataset['purpose']}`, а не независимая оценка качества модели.
`independent_labels={str(dataset['independent_labels']).lower()}` и
`quality_claim_allowed={str(dataset['quality_claim_allowed']).lower()}`.

## Измерения

- predictions с валидным JSON: {report['format_validation']['valid_json_count']}/{report['format_validation']['predictions_received']};
- predictions с валидной минимальной схемой: {report['format_validation']['valid_schema_count']}/{report['format_validation']['predictions_received']};
- priority accuracy: {priority['accuracy']};
- priority macro-F1: {priority['macro_f1']};
- category accuracy: {category['accuracy']};
- category macro-F1: {category['macro_f1']};
- `critical → low`: {guardrail['critical_to_low_count']} при {guardrail['critical_label_count']} critical labels;
- grounded evidence quotes: {evidence['grounded_quote_count']}/{evidence['evidence_quote_count']}.

**Ограничение:** совпадение evidence quote с исходным текстом не доказывает
фактологичность всех утверждений summary. Для quality benchmark нужны независимо
размеченные специалистом примеры, включая critical cases.

## Воспроизведение

```bash
{report['reproduction_command']}
```

Машиночитаемые результаты: `report.json` и `rows.csv` в этой папке.
"""


def _display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def _reproduction_command(
    labels_path: Path,
    predictions_path: Path,
    publications_path: Path,
    output_dir: Path,
) -> str:
    values = [
        ".venv/bin/python",
        "scripts/evaluate_analysis.py",
        "--labels",
        _display_path(labels_path),
        "--predictions",
        _display_path(predictions_path),
        "--publications",
        _display_path(publications_path),
        "--output-dir",
        _display_path(output_dir),
    ]
    return " ".join(shlex.quote(value) for value in values)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--labels", type=Path, default=DEFAULT_LABELS)
    parser.add_argument("--predictions", type=Path, default=DEFAULT_PREDICTIONS)
    parser.add_argument("--publications", type=Path, default=DEFAULT_PUBLICATIONS)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    args = parser.parse_args()

    labels_path = args.labels.resolve()
    predictions_path = args.predictions.resolve()
    publications_path = args.publications.resolve()
    output_dir = args.output_dir.resolve()
    report, rows = evaluate(
        load_json(labels_path),
        load_json(predictions_path),
        load_json(publications_path),
    )
    write_artifacts(
        output_dir,
        report,
        rows,
        labels_path=labels_path,
        predictions_path=predictions_path,
        publications_path=publications_path,
    )
    print(
        f"evaluated {len(rows)} publications: "
        f"priority_accuracy={report['priority']['accuracy']}, "
        f"critical_to_low={report['critical_guardrail']['critical_to_low_count']}"
    )


if __name__ == "__main__":
    main()
