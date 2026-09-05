# Technical eval: seed-replay-self-consistency-v1

## Статус результата

**Факт:** это `plumbing_smoke`, а не независимая оценка качества модели.
`independent_labels=false` и
`quality_claim_allowed=false`.

## Измерения

- predictions с валидным JSON: 10/10;
- predictions с валидной минимальной схемой: 10/10;
- priority accuracy: 1.0;
- priority macro-F1: 1.0;
- category accuracy: 1.0;
- category macro-F1: 1.0;
- `critical → low`: 0 при 0 critical labels;
- grounded evidence quotes: 10/10.
- mean summary/input character ratio: 1.579867 (10 measured summaries).

**Ограничение:** совпадение evidence quote с исходным текстом не доказывает
фактологичность всех утверждений summary. Для quality benchmark нужны независимо
размеченные специалистом примеры, включая critical cases.

## Воспроизведение

```bash
.venv/bin/python scripts/evaluate_analysis.py --labels data/eval/smoke-labels-v1.json --predictions data/seed/replay-analyses.json --publications data/seed/publications.json --output-dir data/eval/results/seed-replay-smoke-v1
```

Машиночитаемые результаты: `report.json` и `rows.csv` в этой папке.
