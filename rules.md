# Зафиксированные правила проекта

Статус: **protected context**. Файл нельзя менять в обычном feature-коммите.

## 1. Структура

Каноническая структура приведена в `README.md`. Новая верхнеуровневая папка,
перенос модуля или изменение владельца зоны считаются архитектурным изменением.

## 2. API-first

Единственный источник истины для HTTP API — `contracts/openapi.yaml`.
Backend обязан соответствовать контракту. Frontend генерирует/описывает типы из
контракта и до интеграции использует `contracts/examples/*.json` как fixtures.

HTTP naming версии 0.2:

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
- синхронная операция возвращает фактический результат. `202/job_id` допустимы
  только вместе с реальным хранилищем заданий и endpoint чтения статуса.

## 3. Версионирование решений

- исходная публикация неизменяема после импорта, кроме исправления метаданных;
- каждый AI-анализ создаёт новую `AnalysisVersion`;
- каждое решение специалиста создаёт новый `SpecialistDecision`;
- AI не может записывать `final_priority`;
- lifecycle НПА — append-only последовательность `LifecycleEvent`.

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

- коммитятся только `data/seed/*.json` и обезличенные данные `data/eval/`;
- локальная SQLite создаётся командой `python3 scripts/seed_demo.py`;
- файлы `*.sqlite*` не коммитятся;
- импорт идемпотентен по `source + external_id`, canonical URL и хешу контента;
- demo/replay не зависит от сети или LLM.

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
