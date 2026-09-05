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

## Live LLM и semantic dedup smoke

Два дополнительных запуска проверяют реальный runtime без заявления о качестве:

```bash
.venv/bin/python scripts/evaluate_live_analysis.py
.venv/bin/python scripts/evaluate_dedup.py
```

`live-llm-smoke-v1` измеряет timeout, latency, отношение длины summary к исходнику,
число предложений и grounding evidence. `dedup-smoke-v1` проверяет embeddings,
cosine similarity и расчёт экспериментального threshold на прозрачных синтетических
парах. Оба набора имеют `quality_claim_allowed=false`; production threshold требует
независимой ручной разметки реальных пар.

Сохранённые live-артефакты:

- `results/live-qwen35-cpu-smoke-v1/` — controlled timeout локального Qwen;
- `results/live-collection-smoke-v1/` — повторный сбор 13 RSS/Telegram источников;
- `results/live-collection-breakdown-v2/` — раздельные `already_seen` и
  `content_duplicates` на повторном live polling;
- `results/live-dedup-backfill-v1/` — первый backfill на 20 публикациях;
- `results/live-dedup-cache-v1/` — измерение пакетного embedding-кэша на 40 → 41
  публикации.
- `results/pre-release-smoke-v1/` — связность UI → real API → SQLite, общий live-сбор
  и сквозной human-in-the-loop/lifecycle сценарий.

Эти результаты проверяют исполнение и отказоустойчивость. Они не заменяют
независимую разметку summary factuality, category/priority или duplicate verdict.
