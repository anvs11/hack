# Pre-release local smoke v1

Дата: 2026-09-05
Quality claim: запрещён — это проверка связности, а не качества моделей.

## Команды

```bash
PYTHONPATH=. .venv/bin/python -m pytest backend/tests -q
node node_modules/typescript/bin/tsc -b --pretty false
node node_modules/vitest/vitest.mjs run
node node_modules/vite/bin/vite.js build
```

Live-сбор запускался кнопкой `Собрать live · 13` на `/sources`. Остальные сценарии
проверены через UI на real API и `.local/live.sqlite3`.

## Результат

- backend: 167 tests passed;
- frontend: 123 tests passed;
- typecheck и production build прошли;
- lint: 0 ошибок, 10 предупреждений;
- общий сбор: 13/13 источников, 312 получено, 0 новых, 311 уже известных ID/URL,
  1 совпадение текста;
- replay-анализ создал v2, не изменив v1;
- решение специалиста, связь с НПА и официальный lifecycle event сохранились;
- live-LLM без credential вернул контролируемую ошибку и не создал partial version.

## Внешние блокеры

Не проверены постоянный HTTPS-сервер, внешний live-LLM и реальный Telegram Mini App:
для них нужны соответственно подтверждённый VPS, inference credential и BotFather
token/public Web App URL.
