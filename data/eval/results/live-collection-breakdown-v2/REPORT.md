# Live collection dedup breakdown v2

Дата запуска: 2026-09-05
Команда:

```bash
.venv/bin/python scripts/run_collection_worker.py --db .local/live.sqlite3 --once
```

## Результат

| Метрика | Значение | Смысл |
| --- | ---: | --- |
| `collected` | 312 | Записей вернули источники в этом polling |
| `created` | 61 | Новых публикаций сохранено |
| `already_seen` | 250 | Тот же source/external ID или canonical URL уже был в БД |
| `content_duplicates` | 1 | Совпал только SHA-256 нормализованного текста |
| `exact_duplicates` | 251 | Deprecated compatibility sum |

Все 61 новые для базы записи пришли из RSS Ведомостей. Это не означает, что все они
были опубликованы после предыдущего polling: их `published_at` лежит в диапазоне
2026-07-18—2026-09-05, то есть состав окна RSS изменился. После сбора
embedding-backfill обработал корпус из 372 публикаций, создал 61 новую candidate pair
за 21.929 секунды.

## Граница вывода

`already_seen` не означает, что две разные новости признаны одинаковыми по смыслу.
Это защита от повторной вставки одной записи при периодическом polling. Semantic
similarity и генеративное решение должны измеряться отдельно; quality claim и
production threshold этим запуском не подтверждены.
