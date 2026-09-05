#!/usr/bin/env python3
"""Measure semantic dedup plumbing on a small transparent smoke dataset."""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.modules.sources.embeddings import (  # noqa: E402
    HuggingFaceEmbedder,
    cosine_similarity,
)


DEFAULT_PAIRS = ROOT / "data" / "eval" / "dedup-smoke-pairs-v1.json"
DEFAULT_OUTPUT_DIR = ROOT / "data" / "eval" / "results" / "dedup-smoke-v1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pairs", type=Path, default=DEFAULT_PAIRS)
    parser.add_argument("--model-id", default="Qwen/Qwen3-Embedding-0.6B")
    parser.add_argument("--cache-dir", type=Path, default=ROOT / ".local" / "huggingface")
    parser.add_argument("--allow-download", action="store_true")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    return parser.parse_args()


def evaluate(args: argparse.Namespace) -> dict[str, Any]:
    document = json.loads(args.pairs.read_text(encoding="utf-8"))
    items = document.get("items")
    if not isinstance(items, list) or not items:
        raise ValueError("pairs document must contain non-empty items")
    allowed_labels = {"duplicate", "related", "different"}
    if any(item.get("label") not in allowed_labels for item in items):
        raise ValueError("every pair must have duplicate, related or different label")

    texts = [text for item in items for text in (item["left"], item["right"])]
    embedder = HuggingFaceEmbedder(
        model_id=args.model_id,
        cache_dir=args.cache_dir,
        download_allowed=args.allow_download,
    )
    started = time.perf_counter()
    vectors = embedder.embed(texts)
    elapsed = time.perf_counter() - started
    rows = []
    grouped: dict[str, list[float]] = defaultdict(list)
    for index, item in enumerate(items):
        similarity = cosine_similarity(vectors[index * 2], vectors[index * 2 + 1])
        grouped[item["label"]].append(similarity)
        rows.append({"id": item["id"], "label": item["label"], "similarity": round(similarity, 6)})

    threshold = _exploratory_threshold(rows)
    return {
        "measurement": {
            "kind": document.get("purpose"),
            "dataset_id": document.get("dataset_id"),
            "independent_labels": document.get("independent_labels"),
            "quality_claim_allowed": document.get("quality_claim_allowed"),
            "model": args.model_id,
            "pair_count": len(rows),
            "embedding_seconds": round(elapsed, 3),
        },
        "similarity_by_label": {
            label: {
                "count": len(values),
                "min": round(min(values), 6),
                "mean": round(sum(values) / len(values), 6),
                "max": round(max(values), 6),
            }
            for label, values in sorted(grouped.items())
        },
        "exploratory_binary_threshold": threshold,
        "production_threshold": None,
        "production_threshold_reason": "Independent real duplicate labels are required.",
        "rows": rows,
    }


def _exploratory_threshold(rows: list[dict[str, Any]]) -> dict[str, Any]:
    scores = sorted({float(row["similarity"]) for row in rows})
    candidates = [scores[0] - 1e-6, *scores, scores[-1] + 1e-6]
    evaluated = []
    for threshold in candidates:
        true_positive = sum(
            row["label"] == "duplicate" and row["similarity"] >= threshold
            for row in rows
        )
        false_positive = sum(
            row["label"] != "duplicate" and row["similarity"] >= threshold
            for row in rows
        )
        false_negative = sum(
            row["label"] == "duplicate" and row["similarity"] < threshold
            for row in rows
        )
        precision = true_positive / (true_positive + false_positive) if true_positive + false_positive else 0.0
        recall = true_positive / (true_positive + false_negative) if true_positive + false_negative else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        evaluated.append((f1, precision, recall, threshold))
    f1, precision, recall, threshold = max(evaluated, key=lambda item: (item[0], item[1], item[2], item[3]))
    return {
        "threshold": round(threshold, 6),
        "precision": round(precision, 6),
        "recall": round(recall, 6),
        "f1": round(f1, 6),
        "deployable": False,
    }


def write_report(report: dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    measurement = report["measurement"]
    threshold = report["exploratory_binary_threshold"]
    markdown = f"""# Semantic dedup plumbing smoke

- Model: `{measurement['model']}`
- Pairs: {measurement['pair_count']}
- Embedding time: {measurement['embedding_seconds']} seconds
- Exploratory threshold: {threshold['threshold']}
- Exploratory F1: {threshold['f1']}
- Production threshold: not selected

The dataset is synthetic and not independently labelled. The result validates the
embedding, cosine-similarity and threshold-evaluation plumbing only; it must not be
used as a production quality claim.

Reproduce from the repository root:

```bash
.venv/bin/python scripts/evaluate_dedup.py
```
"""
    (output_dir / "REPORT.md").write_text(markdown, encoding="utf-8")


def main() -> int:
    args = parse_args()
    report = evaluate(args)
    write_report(report, args.output_dir)
    print(json.dumps(report["similarity_by_label"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
