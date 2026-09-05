# AI-аналитический центр для PR/GR

MVP собирает публикации из СМИ, регуляторных сайтов и публичных Telegram-каналов,
формирует воспроизводимый AI-анализ и передаёт карточку специалисту для
финального решения. НПА ведутся отдельными карточками с append-only lifecycle
и фиксированной матрицей допустимых переходов.

## Зафиксированный контракт v0.4.0

В текущем срезе зафиксированы:

1. структура репозитория;
2. модели API в `contracts/openapi.yaml`;
3. эталонные JSON в `contracts/examples/`;
4. offline seed: 5 источников, 10 публикаций, 10 replay-анализов
   и 1 демонстрационный кейс НПА;
5. синхронный live-сбор 13 источников с раздельным отчётом о повторно
   увиденных ID/URL и совпадениях текста;
6. semantic duplicate candidates и append-only решения человека;
7. ручное создание, исправление metadata и soft-hide публикаций;
8. Telegram Mini App initData authentication;
9. replay, локальный Hugging Face и OpenAI-compatible LLM adapters;
10. канонические команды запуска backend, frontend и CPU VPS.

Правила изменения контракта описаны в `rules.md`, инструкции агентам — в
`AGENTS.md`, продуктовый контекст — в `CONTEXT_PACK.md`. Эти файлы нужно читать
до начала работы.

## Структура репозитория

```text
.
├── AGENTS.md
├── README.md
├── rules.md
├── CONTEXT_PACK.md
├── contracts/
│   ├── openapi.yaml
│   └── examples/
├── backend/
│   └── app/
│       ├── main.py
│       └── modules/
│           ├── sources/
│           ├── publications/
│           ├── analysis/
│           ├── prioritization/
│           ├── auth/
│           ├── decisions/
│           └── regulatory_cases/
├── frontend/
├── data/
│   ├── seed/
│   ├── live/
│   └── eval/
├── deploy/
├── scripts/
│   ├── seed_demo.py
│   ├── sync_live_sources.py
│   ├── run_collection_worker.py
│   ├── evaluate_analysis.py
│   ├── evaluate_live_analysis.py
│   └── evaluate_dedup.py
└── docs/
    ├── BACKEND_TODO.md
    ├── FRONTEND_API_CHANGES.md
    ├── FULL_ARCHITECTURE.md
    ├── PRE_RELEASE_CHECKLIST.md
    ├── SOURCE_INVENTORY.md
    └── DEPLOYMENT.md
```

Новые верхнеуровневые каталоги добавляются только через процедуру изменения
protected context из `rules.md`.

## HTTP API v0.4.0

Реализованы:

- `GET /api/health`;
- `GET /api/sources`, `POST /api/sources`, `PATCH /api/sources/{source_id}`;
- `POST /api/sources/{source_id}/collections`, `POST /api/collections`;
- `POST /api/demo/seed`;
- `GET /api/publications`, `POST /api/publications`;
- `GET /api/publications/{publication_id}`, `PATCH /api/publications/{publication_id}`;
- `POST /api/publications/{publication_id}/analyses`.
- `GET /api/duplicate-candidates`;
- `POST /api/duplicate-candidates/{candidate_id}/reviews`;
- `POST /api/auth/telegram`.

Для карточки публикации также реализованы создание append-only решений,
история анализов/решений, чтение и создание кейсов НПА, идемпотентная привязка
публикации к кейсу и `POST /api/regulatory-cases/{case_id}/lifecycle-events`.
Timeline загружается из БД; lifecycle events и решения специалиста остаются append-only.
Канонические имена и JSON-форматы описаны только в `contracts/openapi.yaml`.

Frontend позволяет вручную добавить публикацию, исправить title/tags, скрыть или
вернуть карточку, запустить новую версию AI-анализа и разобрать очередь похожих пар.

## Канонические команды

### Локальный seed

Не требует сторонних зависимостей:

```bash
python3 scripts/seed_demo.py
```

По умолчанию создаётся `.local/demo.sqlite3`. Повторный запуск обновляет те же
записи и не создаёт дубли. Другой путь: `python3 scripts/seed_demo.py --db /tmp/demo.sqlite3`.

### Backend

Установка базовых зависимостей из корня:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements-dev.txt
```

Запуск:

```bash
.venv/bin/python -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

Health-check: `GET http://127.0.0.1:8000/api/health`.

### Frontend

Установка и запуск:

```bash
npm --prefix frontend ci
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173
```

UI: `http://127.0.0.1:5173`.

### Live-источники

```bash
.venv/bin/python scripts/sync_live_sources.py --db .local/live.sqlite3
.venv/bin/python scripts/run_collection_worker.py --db .local/live.sqlite3 --once
```

Первый скрипт идемпотентно синхронизирует `data/live/sources.json`, второй опрашивает
13 включённых RSS/Telegram источников. Периодический режим по умолчанию запускается
раз в 30 минут без `--once`.

В `CollectionReport` поле `collected` означает число записей, возвращённых
источниками в текущем опросе, а не число новых публикаций. `already_seen` считает
уже известные external ID/URL, `content_duplicates` — совпадения SHA-256
нормализованного текста, `created` — действительно добавленные публикации.
`exact_duplicates` сохранено только для совместимости и равно сумме первых двух
счётчиков.

### LLM и embeddings

Optional ML-зависимости:

```bash
.venv/bin/python -m pip install -r backend/requirements-llm.txt
```

Локальный режим использует `HACK_LLM_PROVIDER=huggingface_local`. Для дешёвого CPU
VPS рекомендуется `HACK_LLM_PROVIDER=openai_compatible` вместе с
`HACK_LLM_API_BASE_URL`, `HACK_LLM_API_KEY` и `HACK_LLM_API_MODEL_ID`. Секреты не
хранятся в Git. Без доступного provider live-анализ завершается контролируемой ошибкой
и не создаёт частичную версию. Live summary принимается только как 3-5 предложений;
для исходника от 500 символов оно должно быть короче исходного текста.

Для reasoning-моделей совместимый provider можно дополнительно настроить через
`HACK_LLM_REASONING_EFFORT`. Например, значение `none` отключает внутреннее
рассуждение у CloudCompute Qwen и оставляет токены для структурированного ответа.
В Docker Compose ключи передаются через файлы `deploy/secrets/llm_api_key` и
`deploy/secrets/telegram_bot_token`, а не через `deploy/.env`.

Semantic backfill сохраняет embeddings пакетами в SQLite и при повторном запуске
считает только отсутствующие или устаревшие по `content_hash` векторы:

```bash
.venv/bin/python scripts/backfill_duplicate_candidates.py --limit 40
```

### Deploy

Docker Compose и безопасная процедура остановки описаны в
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Создание платного VPS не является частью
локальной команды и требует отдельного подтверждения цены в панели провайдера.
Актуальные P0/P1-риски и ручной сценарий собраны в
[`docs/PRE_RELEASE_CHECKLIST.md`](docs/PRE_RELEASE_CHECKLIST.md).

## Полная локальная проверка

```bash
python3 -m json.tool data/seed/sources.json >/dev/null
python3 -m json.tool data/seed/publications.json >/dev/null
python3 -m json.tool data/seed/replay-analyses.json >/dev/null
python3 -m json.tool data/seed/regulatory-cases.json >/dev/null
ruby -e "require 'yaml'; YAML.load_file('contracts/openapi.yaml')"
.venv/bin/python -m pytest backend/tests -q
.venv/bin/python scripts/evaluate_analysis.py
.venv/bin/python scripts/evaluate_dedup.py
npm --prefix frontend run generate:api
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run test -- --run
npm --prefix frontend run build
```

Для отдельной проверки seed используйте временный файл, например
`python3 scripts/seed_demo.py --db /tmp/hack-demo.sqlite3`. SQLite из `/tmp` или
`.local/` не добавляется в Git.

Live LLM smoke запускается отдельно, потому что требует весов или внешнего API:
`.venv/bin/python scripts/evaluate_live_analysis.py`. Все eval-артефакты явно
помечают, разрешено ли делать вывод о качестве модели.
