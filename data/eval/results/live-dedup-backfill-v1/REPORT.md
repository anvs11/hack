# Live semantic dedup backfill smoke

**Факт:** `Qwen/Qwen3-Embedding-0.6B` обработала поднабор из 20 реально собранных
публикаций за 27,405 секунды и создала 19 ближайших пар для ручной проверки.
Повторный запуск создал 0 строк и завершился за 0,009 секунды. Максимальный cosine
similarity в этом поднаборе — 0,8898.

**Ограничение:** production threshold не выбран. Пары не размечены независимым
специалистом, поэтому similarity используется только для сортировки очереди и не
удаляет публикации автоматически.

```bash
HACK_EMBEDDING_MAX_INPUT_CHARS=600 \
  .venv/bin/python scripts/backfill_duplicate_candidates.py --limit 20
```
