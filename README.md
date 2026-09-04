# AI-аналитический центр для PR/GR

MVP собирает публикации из СМИ, регуляторных сайтов и Telegram-архивов,
формирует воспроизводимый AI-анализ и передаёт карточку специалисту для
финального решения. НПА ведутся отдельными карточками с append-only lifecycle.

## Зафиксированный контракт v0.2

В текущем срезе зафиксированы:

1. структура репозитория;
2. модели API в `contracts/openapi.yaml`;
3. эталонные JSON в `contracts/examples/`;
4. offline seed: 5 источников, 10 публикаций, 10 replay-анализов
   и 1 демонстрационный кейс НПА;
5. синхронный сбор с отчётом, exact dedup и optional semantic candidates;
6. replay-анализ и ленивые Hugging Face adapters без автоматического скачивания;
7. канонические команды запуска backend и frontend.

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
│           ├── decisions/           # следующий срез
│           ├── regulatory_cases/    # следующий срез
│           └── digests/             # следующий срез
├── frontend/
├── data/
│   ├── seed/
│   └── eval/
├── scripts/
│   ├── seed_demo.py
│   └── evaluate_analysis.py
└── docs/
    ├── BACKEND_TODO.md
    ├── FRONTEND_API_CHANGES.md
    ├── FULL_ARCHITECTURE.md
    └── SOURCE_INVENTORY.md
```

Каталоги с пометкой «следующий срез» являются целевыми, остальные уже реализованы.
Новые верхнеуровневые каталоги добавляются только через процедуру изменения
protected context из `rules.md`.

## HTTP API v0.2

Реализованы:

- `GET /api/health`;
- `GET /api/sources`, `POST /api/sources`, `PATCH /api/sources/{source_id}`;
- `POST /api/sources/{source_id}/collections`, `POST /api/collections`;
- `POST /api/demo/seed`;
- `GET /api/publications`, `GET /api/publications/{publication_id}`;
- `POST /api/publications/{publication_id}/analyses`.

Для карточки публикации также реализованы создание append-only решений,
история анализов/решений, чтение кейсов НПА и идемпотентная привязка
публикации к кейсу. Lifecycle transitions и создание кейсов в этот срез не входят.
Канонические имена и JSON-форматы описаны только в `contracts/openapi.yaml`.

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

## Полная локальная проверка

```bash
python3 -m json.tool data/seed/sources.json >/dev/null
python3 -m json.tool data/seed/publications.json >/dev/null
python3 -m json.tool data/seed/replay-analyses.json >/dev/null
python3 -m json.tool data/seed/regulatory-cases.json >/dev/null
ruby -e "require 'yaml'; YAML.load_file('contracts/openapi.yaml')"
.venv/bin/python -m pytest backend/tests -q
.venv/bin/python scripts/evaluate_analysis.py
npm --prefix frontend run generate:api
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run test -- --run
npm --prefix frontend run build
```

Для отдельной проверки seed используйте временный файл, например
`python3 scripts/seed_demo.py --db /tmp/hack-demo.sqlite3`. SQLite из `/tmp` или
`.local/` не добавляется в Git.

Optional LLM-зависимости устанавливаются отдельно из
`backend/requirements-llm.txt`. Скачивание моделей выключено по умолчанию; параметры
окружения описаны в `docs/FULL_ARCHITECTURE.md`.
