# B8: воспроизводимый E2E и demo-сценарий

## Назначение

Demo проверяет полный путь данных через настоящий локальный FastAPI и отдельную
временную SQLite: offline seed → очередь публикаций → решение специалиста → связь
с существующим НПА → официальное lifecycle event → клиентский дайджест. Канонический
автоматический сценарий выполняет все продуктовые действия через UI; напрямую
запускаются только seed и два локальных процесса.

## Предварительные требования

- Python virtual environment `.venv` с зависимостями из
  `backend/requirements-dev.txt`;
- Node.js и зависимости `frontend/node_modules` из lock-файла;
- Chromium, установленный для текущей версии Playwright;
- свободные локальные порты `127.0.0.1:8000` и `127.0.0.1:5173`.

Первичная установка может требовать интернет:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements-dev.txt
npm --prefix frontend ci
cd frontend && npx playwright install chromium
```

После установки Python/npm-зависимостей и Chromium основной E2E не использует
внешнюю сеть, не скачивает модели и не вызывает LLM.

## Однокомандный E2E

Из корня репозитория:

```bash
npm --prefix frontend run e2e
```

Для локальной диагностики с видимым Chromium:

```bash
npm --prefix frontend run e2e:headed
```

Runner проверяет, что оба порта свободны, создаёт уникальный каталог через
`mkdtemp`, запускает существующий `scripts/seed_demo.py`, передаёт временную SQLite
в backend через `HACK_DATABASE_URL`, запускает frontend с
`VITE_API_BASE_URL=http://127.0.0.1:8000`, ожидает health/UI и только затем запускает
Playwright. В `finally` он завершает обе группы дочерних процессов и удаляет весь
временный каталог вместе с БД, trace и screenshots. `workers=1`; существующие
серверы намеренно не переиспользуются.

## Ручной запуск с real API

В терминале из корня репозитория создайте изолированную БД и сохраните путь в
переменных текущей shell-сессии:

```bash
DEMO_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hack-demo.XXXXXX")"
DEMO_DB="$DEMO_TMP_DIR/demo.sqlite3"
.venv/bin/python scripts/seed_demo.py --db "$DEMO_DB"
export HACK_DATABASE_URL="sqlite:///$DEMO_DB"
```

Запустите backend и запомните PID:

```bash
.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 &
DEMO_BACKEND_PID=$!
```

Запустите frontend в той же shell-сессии либо повторно экспортируйте переменные в
новой:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000 npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173 --strictPort &
DEMO_FRONTEND_PID=$!
```

Проверки готовности и URL интерфейса:

```bash
curl --fail http://127.0.0.1:8000/api/health
curl --fail http://127.0.0.1:5173/feed
```

Откройте `http://127.0.0.1:5173/feed`.

## Начальное ожидаемое состояние

Чистый seed содержит:

- 5 источников;
- 10 публикаций;
- 10 результатов replay-анализа;
- один `case-001` с номером `DEMO-2026-001` и стадией `draft` («Проект»);
- 0 `SpecialistDecision`;
- 0 `LifecycleEvent`;
- ни одной связи публикации с `case-001`.

## Основной ручной сценарий

1. На `/feed` дождитесь заголовка «Лента сигналов» и счётчика 10 материалов.
2. В поле «AI-приоритет» выберите «Высокий». URL должен содержать
   `proposed_priority=high`, а индикатор — «Активно: 1». Публикация «Проект
   требований к обработке данных вынесен на обсуждение» видна; low-публикация
   «ИТ-компания объявила о запуске образовательной программы» отсутствует.
3. Откройте публикацию по заголовку. Видны `analysis-001`, «AI-приоритет · Высокий»
   и «1 AI · 0 решений».
4. В блоке «Подтвердить или скорректировать» не меняйте AI-саммари и категорию.
   В поле «Финальный приоритет» выберите «Критический», в «Комментарий ·
   необязательно» введите `B8 E2E: критический приоритет подтверждён` и нажмите
   «Сохранить решение».
5. Ожидайте сообщение «Решение специалиста сохранено в истории.», статус
   «Скорректировано», финальный приоритет «Критический», комментарий и счётчик
   «1 AI · 1 решений». Исходный AI-приоритет остаётся «Высокий».
6. Нажмите «Привязать к НПА». В диалоге выберите «Демонстрационные требования к
   обработке данных» / `DEMO-2026-001`, затем «Подтвердить привязку». Ожидайте
   «Публикация успешно привязана к НПА.» и метку «Уже привязана». Закройте диалог.
7. В основной навигации нажмите «Кейс НПА». В `case-001` видны заголовок кейса,
   текущая стадия «Проект», связанная `pub-001` и пустое состояние «Событий пока
   нет».
8. В форме «Добавить официальное событие» задайте:
   - «Стадия»: «Проект»;
   - «Дата события»: `04.09.2026 12:00` (значение input — `2026-09-04T12:00`);
   - «Ссылка на официальное подтверждение»:
     `https://regulation.gov.ru/e2e/case-001`;
   - «Тип официального источника»: «Официальный сайт регулятора»;
   - «Комментарий · необязательно»:
     `B8 E2E: начальная стадия подтверждена`;
   - «Автор события»: `user-gr-001`.
9. Нажмите «Добавить событие». Ожидайте сообщение «Официальное событие добавлено.
   Стадия и хронология обновлены с сервера.». В «Хронологии» ровно одно событие со
   стадией «Проект», датой 4 сентября 2026 12:00, введёнными URL, комментарием и
   автором. Серверная текущая стадия остаётся «Проект».
10. В основной навигации нажмите «Дайджест». Дождитесь scope
    `all_available_data` и четырёх разделов: «Подтверждённые критические
    материалы», «Изменения стадий НПА», «Требующие проверки карточки», «Действия
    пользователей».
11. Сводные счётчики должны быть: «Критические» — 1, «Стадии НПА» — 1, «На
    проверке» — 6, «Действия» — 2. Критический раздел содержит `pub-001`,
    «Скорректировано» и «Критический»; lifecycle-раздел — `case-001`, начальную
    стадию «Проект» и lifecycle-комментарий; действия — оба введённых комментария.

## Состояние после сценария

- одна append-only `SpecialistDecision` для `pub-001`: `status=corrected`,
  `final_priority=critical`, анализ `analysis-001` не изменён;
- `pub-001` связана с существующим `case-001`;
- одно начальное append-only `LifecycleEvent` стадии `draft`;
- текущая стадия `case-001` по-прежнему `draft`;
- digest counters: `1 / 1 / 6 / 2` в порядке critical / lifecycle / review / actions.

## Команды проверок

Полная проверка B8:

```bash
cd frontend
npm test -- --run
npm run typecheck
npm run lint
npm run build
npm run generate:api
git diff --exit-code -- src/shared/api/schema.d.ts
npm run e2e
npm run e2e
cd ..
.venv/bin/python -m pytest backend/tests -q
git diff --check
git status --short --branch
```

Проверить runtime-строки в ручной SQLite можно так:

```bash
sqlite3 "$DEMO_DB" "SELECT id, status, json_extract(payload_json, '$.final_priority') FROM specialist_decisions;"
sqlite3 "$DEMO_DB" "SELECT case_id, publication_id FROM regulatory_case_publications;"
sqlite3 "$DEMO_DB" "SELECT regulatory_case_id, stage, occurred_at, confirmation_source_type FROM lifecycle_events;"
```

Канонический E2E также падает при `console.error`, необработанном `pageerror` и
любом browser request к несуществующему `/api/digest`.

## Остановка и очистка ручного demo

В shell-сессии, где сохранены PID и путь:

```bash
kill "$DEMO_FRONTEND_PID" "$DEMO_BACKEND_PID"
wait "$DEMO_FRONTEND_PID" "$DEMO_BACKEND_PID" 2>/dev/null || true
rm -rf -- "$DEMO_TMP_DIR"
unset HACK_DATABASE_URL DEMO_DB DEMO_TMP_DIR DEMO_FRONTEND_PID DEMO_BACKEND_PID
```

Перед `rm -rf` убедитесь, что `DEMO_TMP_DIR` получен именно командой `mktemp` выше.
Автоматический runner выполняет остановку и удаление самостоятельно даже после
ошибки теста или сигнала завершения.

## Fallback A — real API без сети и LLM

Используйте versioned offline seed и обычные команды ручного запуска выше. Не
запускайте live collection и не выбирайте `live_llm`: все десять анализов получены
replay-анализатором. После предварительной установки зависимостей demo работает без
внешней сети. Replay — заранее сохранённый результат, а не live inference.

## Fallback B — frontend mock

```bash
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173
```

Если `VITE_API_BASE_URL` не задан, frontend включает MSW. Этот режим подходит для
демонстрации интерфейса, но не доказывает работу настоящей SQLite, backend
persistence или CORS. Канонический E2E всегда использует real API. Первичная
установка npm/Python dependencies и Playwright Chromium может потребовать сеть.

## Факты текущего demo

- Seed локальный и воспроизводимый.
- Replay не вызывает внешнюю LLM и представляет заранее сохранённый результат.
- `SpecialistDecision` и `LifecycleEvent` append-only.
- Финальный приоритет назначает специалист; AI предлагает приоритет.
- Lifecycle принимает только `regulator` или `official_publication`; Telegram и
  СМИ не подтверждают стадию.
- Дайджест — клиентский снимок по существующим read API.
- Серверного digest endpoint и хранения версий нет.
- UI выбора существующего НПА реализован.
- UI создания нового НПА отсутствует.

## Гипотезы и то, что demo не доказывает

- качество live LLM и фактическую достоверность AI-саммари;
- юридическую корректность решений специалиста;
- полезность скоринга на реальных данных;
- работоспособность live-сбора всех внешних источников;
- производительность и масштабируемость;
- ценность дайджеста для реальных руководителей;
- email/Telegram-доставку;
- полный аудит действий за пределами `SpecialistDecision` и `LifecycleEvent`.

## Troubleshooting

- **Порт 8000 или 5173 занят.** Остановите найденный процесс и повторите запуск.
  Runner прекращает работу до seed/server startup и не подключается к чужому
  процессу. Диагностика: `lsof -nP -iTCP:8000 -sTCP:LISTEN` и аналогично для 5173.
- **Executable `.venv/bin/python` не найден или нет FastAPI/Uvicorn.** Создайте venv
  и установите `backend/requirements-dev.txt` командами из предварительных
  требований.
- **Chromium executable отсутствует.** Выполните
  `cd frontend && npx playwright install chromium`; загрузка браузера требует сеть
  один раз для установленной версии Playwright.
- **Нет `frontend/node_modules`.** Выполните `npm --prefix frontend ci`.
- **E2E упал.** Консоль Playwright показывает assertion и вывод серверов. Trace и
  screenshot живут только во временном каталоге runner и удаляются при завершении;
  для интерактивной диагностики используйте `npm --prefix frontend run e2e:headed`.
