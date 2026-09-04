# Контекст разработки PR/GR AI Analytics MVP

Статус: **protected context**  
Обновлено: 2026-09-04, API v0.2

Этот файл — короткая точка входа для разработчика или агента. Подробная архитектура
находится в `docs/FULL_ARCHITECTURE.md`, план — в `docs/BACKEND_TODO.md`. Каталог
`project_analysis/` принадлежит продуктовому контуру и остаётся read-only.

## Факты

- Пользователь текущего рабочего контура отвечает за весь backend; frontend ведётся
  отдельно, кроме необходимых синхронных изменений API-клиента, типов и mock fixtures.
- `Publication` — отдельный входной материал; `RegulatoryCase` — долгоживущая сущность
  НПА; `LifecycleEvent` — неизменяемое событие её истории.
- AI создаёт версию `AnalysisVersion` и предлагает приоритет. Финальное решение
  хранится отдельно как `SpecialistDecision` и принадлежит человеку.
- Текущий backend реализует health, source CRUD без delete, demo seed, read API
  публикаций, создание analysis versions и specialist decisions, историю,
  чтение и создание кейсов НПА, идемпотентную привязку, append-only lifecycle
  с атомарной проекцией текущей стадии, file/RSS collection и exact dedup.
- Semantic dedup сохраняет только кандидатов на ручную проверку и не удаляет данные.
- Demo/replay работает без сети. Qwen adapters ленивые; веса автоматически не
  скачиваются.

## Решения API v0.2

- HTTP-пути используют существительные: `/analyses`, `/decisions`, `/collections`,
  `/lifecycle-events`.
- Импорт воспроизводимых данных отделён от бизнес-API: `POST /api/demo/seed`.
- Сбор пока синхронный и возвращает `CollectionReport`. Фиктивного `job_id` нет.
- В JSON используются `Publication`, `AnalysisVersion`, `regulatory_case` и
  `occurred_at`; nullable-поля ответа присутствуют явно со значением `null`.
- OpenAPI — единственный источник истины. Frontend `schema.d.ts` генерируется из
  `contracts/openapi.yaml`.
- Lifecycle принимает только официальные `regulator` и `official_publication`;
  матрица переходов зафиксирована в `rules.md`.

## Выводы

- Модульный FastAPI-монолит + SQLite достаточны для проверяемого hackathon MVP и не
  мешают позже заменить хранилище или inference adapter.
- Синхронный сбор честнее текущей реализации: клиент сразу получает измеримый итог,
  а асинхронность стоит вводить только вместе с очередью и endpoint статуса.

## Гипотезы

- Объяснимая очередь с human-in-the-loop уменьшит время утреннего разбора без
  сокрытия критичных сигналов.
- Временная формула K1–K6/H1–H4 пригодна для demo, но требует продуктовой валидации.
- Порог cosine similarity можно выбрать только после разметки duplicate/non-duplicate
  пар; до этого similarity не является автоматическим решением.

## Открытые вопросы

- Финальная методика scoring и набор критериев для разных типов публикаций.
- Независимо размеченный quality eval-набор и измеренные quality/latency показатели.
- Реальный доступ к Telegram, HTML-страницам регуляторов и URL Правового комитета АРПП.
- Сроки хранения и архивирования lifecycle-истории.
- Полный publication CRUD, редактирование кейсов НПА и digest API.
