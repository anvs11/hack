# Изменения frontend из-за API v0.6.0

Дата: 2026-09-05
Область: синхронизация frontend с backend-контрактом и необходимые пользовательские
действия. `project_analysis/` не изменялся.

## Добавлено в v0.6.0

| Возможность | Frontend | Backend API |
| --- | --- | --- |
| Два режима без промежуточного | `compact/expert` — «Кратко/Подробно» | `GET/PATCH /api/me` |
| Автоотчёты Telegram | Включение и минимальный приоритет | `GET/PATCH /api/me/telegram-digest-settings` |
| Отправка автоматической сводки | Кнопка на вкладке сводки | `POST /api/telegram/report-deliveries` |

## Добавлено в v0.5.0

| Возможность | Frontend | Backend API |
| --- | --- | --- |
| Личный режим | Первоначальный переключатель `compact/standard/expert`; `standard` удалён в v0.6 | `GET/PATCH /api/me` |
| Стартовые фильтры | Сохранить текущую выборку | `PATCH /api/me` |
| Одна карточка события | Список первоисточников в detail | `Publication.source_references` |
| Отправка отчёта | Кнопка внутри Telegram Mini App | `POST /api/telegram/report-deliveries` |
| Автообновление | Повторный GET ленты через 15 минут | worker собирает данные раз в 15 минут |

Отдельный пользовательский маршрут `/duplicates` удалён. Техническая очередь и
append-only review остаются в API. Открытая карточка запрашивает относящиеся к ней
пары через `publication_id`, а подтверждённый дубль складывает ссылку в каноническую
публикацию.

## Добавлено в v0.3–v0.4

| Возможность | Frontend | Backend API |
| --- | --- | --- |
| Ручная публикация | Диалог в `/feed` | `POST /api/publications` |
| Исправить title/tags | Редактор карточки | `PATCH /api/publications/{id}` |
| Скрыть/вернуть | Тот же редактор | append-only `PublicationRevision` |
| Новый AI-анализ | Кнопка в карточке | `POST /api/publications/{id}/analyses` |
| Совпадение в карточке | Последовательный блок с тремя действиями | `GET /api/duplicate-candidates?publication_id=...` |
| Вердикт по паре | Объединить источники / оставить связанными / разные события | `POST /api/duplicate-candidates/{id}/reviews` |
| Фильтр периода | Два date-поля с inclusive границами дня | `published_from`, `published_to` |
| Прозрачный collection report | Раздельно «уже были» и «совпал текст» | `already_seen`, `content_duplicates` |
| Общий live-сбор | Кнопка `Собрать live · N` и агрегированный отчёт | `POST /api/collections` |
| Telegram Mini App | Runtime передаёт raw `initData` | `POST /api/auth/telegram` |

## Изменено в v0.4.0

- технические `K1…K6` заменены понятными полями `business_relevance`,
  `event_maturity`, `financial_impact`, `implementation_effort`, `risk_severity` и
  `action_urgency`;
- `H1…H4` заменены четырьмя именованными сигналами обязательной проверки;
- `score` переименован в `importance_score`;
- неизвестный критерий передаётся как `null`, а не маскируется нулём;
- карточка показывает русские названия, смысл каждого фактора и значение по шкале
  `0–3`;
- Telegram runtime теперь дожидается асинхронной загрузки официального SDK перед
  backend-auth и показывает статус подтверждённого входа в шапке.

Полная формула и значения полей описаны в `docs/IMPORTANCE_SCORING.md`. Старые ключи
поддерживаются backend только для чтения уже сохранённой локальной БД.

Верхнее demo-меню больше не содержит жёсткую ссылку на `pub-001`. В v0.5 из
пользовательской навигации также удалён технический раздел дублей. История metadata,
AI, решений специалиста и duplicate verdicts не затирается.

## Что изменено

| Было | Стало | Причина |
| --- | --- | --- |
| `PublicationCard` | `Publication` | Это доменная публикация, а не UI-компонент |
| `AnalysisResult` | `AnalysisVersion` | Каждый запуск создаёт неизменяемую версию |
| `detail.case` | `detail.regulatory_case` | Убрано неоднозначное служебное слово `case` |
| `event.effective_at` | `event.occurred_at` | Событие может описывать draft/adopted, не только вступление в силу |
| optional nullable source/status fields | обязательные поля со значением `null` | JSON-форма стабильна для клиента |

Изменённые будущие write-paths:

| Старый путь | Канонический путь v0.2+, сохранённый в v0.3 |
| --- | --- |
| `POST /api/publications/{id}/analyze` | `POST /api/publications/{id}/analyses` |
| `POST /api/publications/{id}/reviews` | `POST /api/publications/{id}/decisions` |
| `POST /api/sources/{id}/refresh` | `POST /api/sources/{id}/collections` |
| `POST /api/collect/run` | `POST /api/collections` |
| `POST /api/import/seed` | Удалён: синтетические данные доступны только автотестам |
| `POST /api/regulatory-cases/{id}/events` | `POST /api/regulatory-cases/{id}/lifecycle-events` |

Связь публикации с кейсом теперь задаётся идемпотентно:
`PUT /api/regulatory-cases/{case_id}/publications/{publication_id}`.

## Какие файлы frontend затронуты

- `src/shared/api/schema.d.ts` — заново сгенерирован из OpenAPI;
- `src/shared/api/types.ts` — aliases переименованы в `Publication` и
  `AnalysisVersion`;
- `src/mocks/fixtures.ts` — mock JSON приведён к обязательным полям v0.3;
- `src/mocks/handlers.ts` — обновлён ключ `regulatory_case`;
- `src/pages/RegulatoryCasePage.tsx` — использует `regulatory_case` и `occurred_at`.
- `src/test/setup.ts` — test-only fetch wrapper больше не передаёт jsdom
  `AbortSignal` в Node/MSW; это устраняет меж-realm падение тестов и не меняет
  browser runtime.
- `src/pages/FeedPage.tsx` — ручное добавление публикации;
- `src/pages/PublicationPage.tsx` — metadata revisions, hide/restore и запуск анализа;
- удалённый `src/pages/DuplicatesPage.tsx` был временным human-in-the-loop экраном;
  API очереди сохранён, но пользователь видит один материал и все его источники;
- `src/pages/SourcesPage.tsx` — один источник и все live-источники можно запустить
  вручную; demo-источники не входят в общий сетевой сбор;
- `src/shared/telegram/TelegramIntegration.tsx` — backend handshake raw `initData`.

Активный read-клиент не потребовал смены URL: он по-прежнему вызывает
`GET /api/publications`, `GET /api/publications/{id}`,
`GET /api/regulatory-cases/{id}` и `GET /api/sources`.

## Проверка при следующем изменении контракта

```bash
npm --prefix frontend run generate:api
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run test -- --run
npm --prefix frontend run build
```

`schema.d.ts` вручную не редактировать.
