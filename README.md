# AI-аналитический центр для PR/GR

MVP собирает публикации из СМИ, регуляторных сайтов и Telegram-архивов,
формирует воспроизводимый AI-анализ и передаёт карточку специалисту для
финального решения. НПА ведутся отдельными карточками с append-only lifecycle.

## Нулевой контракт

До параллельной разработки зафиксированы:

1. структура репозитория;
2. модели API в `contracts/openapi.yaml`;
3. эталонные JSON в `contracts/examples/`;
4. offline seed: 5 источников, 10 публикаций и 10 replay-анализов;
5. канонические команды запуска backend и frontend.

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
│           ├── evaluation/
│           ├── reviews/
│           ├── regulatory_cases/
│           └── digests/
├── frontend/
├── data/
│   ├── seed/
│   └── eval/
├── scripts/
│   └── seed_demo.py
├── tests/
│   └── e2e/
└── docs/
    └── DEMO_SCENARIO.md
```

Пока backend и frontend не созданы, дерево выше является обязательным целевым
каркасом для задач A1/B1. Новые верхнеуровневые каталоги добавляются только через
процедуру изменения protected context из `rules.md`.

## Канонические команды

### Локальный seed

Работает уже на нулевом этапе и не требует сторонних зависимостей:

```bash
python3 scripts/seed_demo.py
```

По умолчанию создаётся `.local/demo.sqlite3`. Повторный запуск обновляет те же
записи и не создаёт дубли. Другой путь: `python3 scripts/seed_demo.py --db /tmp/demo.sqlite3`.

### Backend

После задачи A1 backend обязан запускаться из корня одной командой:

```bash
python3 -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

Health-check: `GET http://127.0.0.1:8000/api/health`.

### Frontend

После задачи B1 frontend обязан запускаться из корня одной командой:

```bash
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173
```

UI: `http://127.0.0.1:5173`.

## Проверки нулевого этапа

```bash
python3 -m json.tool data/seed/sources.json >/dev/null
python3 -m json.tool data/seed/publications.json >/dev/null
python3 -m json.tool data/seed/replay-analyses.json >/dev/null
ruby -e "require 'yaml'; YAML.load_file('contracts/openapi.yaml')"
python3 scripts/seed_demo.py --db /tmp/hack-demo.sqlite3
```

После появления зависимостей backend OpenAPI дополнительно проверяется профильным
валидатором в CI. SQLite из `/tmp` или `.local/` не добавляется в Git.
