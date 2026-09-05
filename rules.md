# Зафиксированные правила проекта

Статус: **protected context**. Файл нельзя менять в обычном feature-коммите.

## 1. Структура

Каноническая структура приведена в `README.md`. Новая верхнеуровневая папка,
перенос модуля или изменение владельца зоны считаются архитектурным изменением.

## 2. API-first

Единственный источник истины для HTTP API — `contracts/openapi.yaml`.
Backend обязан соответствовать контракту. Frontend генерирует/описывает типы из
контракта и до интеграции использует `contracts/examples/*.json` как fixtures.

HTTP naming версии 0.4:

- URL используют существительные во множественном числе, а действие задаётся методом;
- новую версию анализа создаёт
  `POST /api/publications/{publication_id}/analyses`;
- один источник собирает
  `POST /api/sources/{source_id}/collections`, все включённые —
  `POST /api/collections`;
- demo seed импортируется через `POST /api/demo/seed`;
- решение специалиста создаётся через
  `POST /api/publications/{publication_id}/decisions`;
- известная связь publication-case создаётся идемпотентным `PUT` с обоими ID в пути;
- событие НПА создаётся в `/lifecycle-events` и использует время `occurred_at`;
- ручная публикация создаётся через `POST /api/publications`, новая metadata-revision
  — через `PATCH /api/publications/{publication_id}`;
- очередь похожих пар читается через `GET /api/duplicate-candidates`, а человеческий
  вердикт создаётся в `/duplicate-candidates/{candidate_id}/reviews`;
- Telegram launch data проверяется через `POST /api/auth/telegram`;
- синхронная операция возвращает фактический результат. `202/job_id` допустимы
  только вместе с реальным хранилищем заданий и endpoint чтения статуса.

## 3. Версионирование решений

- исходная публикация неизменяема после импорта, кроме исправления метаданных;
- каждый AI-анализ создаёт новую `AnalysisVersion`;
- каждое решение специалиста создаёт новый `SpecialistDecision`;
- AI не может записывать `final_priority`;
- lifecycle НПА — append-only последовательность `LifecycleEvent`.
- title/tags/visibility публикации меняются только новой `PublicationRevision`;
- каждый вердикт по semantic candidate создаёт новый `DuplicateReview`; similarity
  без подтверждения человека не удаляет публикации.

Допустимые lifecycle-переходы:

- `draft → introduced`;
- `introduced → adopted`;
- `adopted → published`;
- `published → effective`;
- `effective → amended | repealed`;
- `amended → effective | repealed`;
- из `repealed` переходов нет.

Первое lifecycle event может подтвердить уже указанную `current_stage`.
После первого события повтор текущей стадии, skip и обратный переход отклоняются
с `409`. Событие и `RegulatoryCase.current_stage` записываются в одной транзакции.

## 4. Seed и локальная БД

- коммитятся `data/seed/*.json`, каталог публичных URL `data/live/sources.json` и
  обезличенные данные `data/eval/`;
- локальная SQLite создаётся командой `python3 scripts/seed_demo.py`;
- файлы `*.sqlite*` не коммитятся;
- импорт идемпотентен по `source + external_id`, canonical URL и хешу контента;
- demo/replay не зависит от сети или LLM.

## 4.1. Внешние границы доверия

- HTTP(S)-коллекторы не обращаются к localhost, loopback и private network address;
- Telegram public preview не использует пользовательскую сессию или секреты;
- bot token и LLM API key читаются только из окружения или смонтированных
  Docker secret-файлов; секреты не входят в образ и репозиторий;
- локальный Hugging Face download выключен по умолчанию;
- OpenAI-compatible provider не меняет контракт `AnalysisVersion` и проходит ту же
  schema/evidence validation.
- live summary проходит backend-проверку 3-5 предложений; для исходника от 500
  символов summary обязан быть короче исходного текста.
- embedding-кэш используется только при совпадении publication, model и content hash;
  он не задаёт production threshold и не разрешает автоматическое удаление.
- collection reporting не смешивает повторный polling и смысловую дедупликацию:
  `already_seen` — тот же ID/URL, `content_duplicates` — тот же SHA-256 текста.

## 5. Канонические команды

Команды backend и frontend закреплены только в `README.md`. Если команда
изменилась, в одном согласованном коммите обновляются `README.md`, этот файл и,
если затронута архитектура, `AGENTS.md`.

## Порядок изменения protected context

1. Описать причину и влияние на оба инженерных контура.
2. Получить явное поручение владельца проекта на изменение protected context.
3. Сделать отдельный коммит с префиксом `context:`.
4. Синхронно обновить затронутые `AGENTS.md`, `README.md`, `rules.md`,
   `CONTEXT_PACK.md`, OpenAPI, JSON-примеры и seed.
5. Проверить OpenAPI, JSON, seed и команды до слияния.

Если реализация расходится с protected context, ошибочной считается реализация,
пока отдельным согласованным коммитом не изменён сам контекст.
