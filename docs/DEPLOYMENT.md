# Развёртывание MVP на CPU VPS

Статус: развернуто 2026-09-05 на
`https://regradar-demo.209-250-246-26.sslip.io`. Конфигурация рассчитана на один
дешёвый Ubuntu VPS и четыре контейнера в Docker Compose.

## Что запускается

| Сервис | Назначение |
| --- | --- |
| `catalog` | Один раз создаёт схему, demo seed и каталог 13 live-источников |
| `backend` | FastAPI и общая SQLite в Docker volume |
| `collector` | Раз в 30 минут опрашивает enabled RSS и публичные Telegram preview |
| `web` | Caddy, React build, HTTPS и reverse proxy `/api/*` |

SQLite работает в WAL mode с `busy_timeout=5000`, поэтому backend и один collector
могут безопасно использовать общий volume. Это конфигурация для hackathon, не схема
горизонтального масштабирования.

## Почему LLM вынесена с VPS

Измеренный local smoke `Qwen/Qwen3.5-0.8B` не завершил одну публикацию за 300 секунд
на CPU. Поэтому базовый образ backend не содержит 3+ ГБ ML-зависимостей и использует
`openai_compatible` adapter. Live smoke через CloudCompute
`qwen/qwen3.8-flash` с `HACK_LLM_REASONING_EFFORT=none` создал валидный анализ за
13.163086 секунды. Это проверка одной публикации, а не подтверждённый SLA или quality
benchmark.

Для CloudCompute используются:

```dotenv
HACK_LLM_PROVIDER=openai_compatible
HACK_LLM_API_BASE_URL=https://app.cloudcompute.ru/api/v1
HACK_LLM_API_MODEL_ID=qwen/qwen3.8-flash
HACK_LLM_MAX_NEW_TOKENS=1024
HACK_LLM_REASONING_EFFORT=none
```

API credential хранится только в некоммитящемся файле
`deploy/secrets/llm_api_key`. Без URL и ключа
endpoint анализа возвращает контролируемую ошибку, а остальные функции продолжают
работать.

Semantic backfill запускается отдельно локально или на более мощной машине. Векторы
сохраняются пакетами в SQLite, поэтому прерванный запуск продолжит только
недостающие публикации:

```bash
.venv/bin/python scripts/backfill_duplicate_candidates.py --limit 40
```

Production threshold отсутствует: пары сохраняются в `/duplicates` для решения
человека.

## Подготовка сервера

Для четырёхдневного demo выбран Ubuntu VPS с 1 vCPU, 1 ГБ RAM и 25 ГБ SSD. LLM
работает во внешнем API, поэтому на VPS остаются FastAPI, SQLite, collector и Caddy.
Перед Docker build добавляется 2 ГБ swap; достаточность этой конфигурации будет
считаться подтверждённой только после remote smoke-test.

После входа по SSH установить Docker Engine и Compose plugin по официальной
инструкции Docker, затем скопировать checkout на сервер. В каталоге проекта:

```bash
cp deploy/.env.example deploy/.env
mkdir -p deploy/secrets
chmod 700 deploy/secrets
```

Заполнить в `deploy/.env` только `APP_DOMAIN` и несекретные LLM-параметры. BotFather
token записать в `deploy/secrets/telegram_bot_token`, а LLM credential — в
`deploy/secrets/llm_api_key`; оба файла должны иметь права `600`. Каталог secrets
игнорируется Git и монтируется в backend через Docker secrets.

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
docker compose --env-file deploy/.env -f deploy/compose.yaml logs --tail=100 backend collector web
```

Проверки:

```bash
curl -fsS https://$APP_DOMAIN/api/health
curl -fsS https://$APP_DOMAIN/api/sources
```

Для Telegram Mini App нужен публичный HTTPS URL. Этот же URL указывается в BotFather
как Web App URL. Пошаговая настройка и smoke-test описаны в
`docs/TELEGRAM_WEB_APP.md`.

## Обновление и остановка

Перед обновлением сохранить резервную копию volume с SQLite. После копирования нового
checkout повторить `docker compose ... up -d --build` и smoke.

После защиты:

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml down
```

`down` сохраняет named volumes. `down -v` удаляет БД и TLS-данные и поэтому без
отдельной резервной копии не используется. Затем VPS удаляется в панели провайдера,
чтобы прекратить следующие списания.
