# Eval data

Здесь хранятся только обезличенные и версионируемые labels и машиночитаемые
результаты eval. Реальные персональные данные и секреты запрещены.

## Формат

- `labels.schema.json` — схема frozen-разметки;
- `smoke-labels-v1.json` — self-consistency labels из replay fixture;
- `results/seed-replay-smoke-v1/report.json` — агрегированные метрики и SHA-256
  входов;
- `results/seed-replay-smoke-v1/rows.csv` — результат по каждой публикации;
- `results/seed-replay-smoke-v1/REPORT.md` — короткий человекочитаемый отчёт.

## Воспроизведение smoke

Из корня репозитория:

```bash
.venv/bin/python scripts/evaluate_analysis.py
```

Smoke использует `data/seed/replay-analyses.json` одновременно как источник
предсказаний и основу labels. Поэтому `independent_labels=false` и
`quality_claim_allowed=false`: значения accuracy/F1 проверяют eval plumbing, но не
являются оценкой качества модели.

Для реального quality benchmark создайте новый frozen labels-файл по схеме,
получите predictions без изменения labels и запустите CLI с `--labels`,
`--predictions`, `--publications` и отдельным `--output-dir`.
