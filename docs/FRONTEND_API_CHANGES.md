# Изменения frontend из-за API v0.2

Дата: 2026-09-04  
Область: только синхронизация frontend с финализированным backend-контрактом.
Визуальный дизайн, маршруты страниц и продуктовая логика интерфейса не менялись.

## Что изменено

| Было | Стало | Причина |
| --- | --- | --- |
| `PublicationCard` | `Publication` | Это доменная публикация, а не UI-компонент |
| `AnalysisResult` | `AnalysisVersion` | Каждый запуск создаёт неизменяемую версию |
| `detail.case` | `detail.regulatory_case` | Убрано неоднозначное служебное слово `case` |
| `event.effective_at` | `event.occurred_at` | Событие может описывать draft/adopted, не только вступление в силу |
| optional nullable source/status fields | обязательные поля со значением `null` | JSON-форма стабильна для клиента |

Изменённые будущие write-paths:

| Старый путь | Канонический путь v0.2 |
| --- | --- |
| `POST /api/publications/{id}/analyze` | `POST /api/publications/{id}/analyses` |
| `POST /api/publications/{id}/reviews` | `POST /api/publications/{id}/decisions` |
| `POST /api/sources/{id}/refresh` | `POST /api/sources/{id}/collections` |
| `POST /api/collect/run` | `POST /api/collections` |
| `POST /api/import/seed` | `POST /api/demo/seed` |
| `POST /api/regulatory-cases/{id}/events` | `POST /api/regulatory-cases/{id}/lifecycle-events` |

Связь публикации с кейсом теперь задаётся идемпотентно:
`PUT /api/regulatory-cases/{case_id}/publications/{publication_id}`.

## Какие файлы frontend затронуты

- `src/shared/api/schema.d.ts` — заново сгенерирован из OpenAPI;
- `src/shared/api/types.ts` — aliases переименованы в `Publication` и
  `AnalysisVersion`;
- `src/mocks/fixtures.ts` — mock JSON приведён к обязательным полям v0.2;
- `src/mocks/handlers.ts` — обновлён ключ `regulatory_case`;
- `src/pages/RegulatoryCasePage.tsx` — использует `regulatory_case` и `occurred_at`.
- `src/test/setup.ts` — test-only fetch wrapper больше не передаёт jsdom
  `AbortSignal` в Node/MSW; это устраняет меж-realm падение тестов и не меняет
  browser runtime.

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
