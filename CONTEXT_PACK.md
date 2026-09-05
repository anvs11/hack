# Контекст разработки PR/GR AI Analytics MVP

Статус: **protected context**  
Обновлено: 2026-09-05, API v0.4.0

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
- Текущий backend реализует health, source CRUD без delete, ручное создание и
  append-only metadata revisions публикаций, soft-hide, создание analysis versions
  и specialist decisions, историю,
  чтение и создание кейсов НПА, идемпотентную привязку, append-only lifecycle
  с атомарной проекцией текущей стадии, file/RSS/Telegram public collection и
  раздельный учёт повторного polling и совпадений текста.
- Каталог `data/live/sources.json` содержит 13 проверенных техническим smoke
  источников; один переданный источник Правового комитета остаётся без URL.
- Semantic dedup сохраняет кандидатов на ручную проверку. Вердикты человека
  append-only; данные автоматически не удаляются.
- Backend проверяет подпись и срок Telegram Mini App `initData`.
- Demo/replay работает без сети. Live LLM поддерживает локальный Hugging Face и
  OpenAI-compatible provider; веса автоматически не скачиваются.
- Измеренный CPU smoke `Qwen3.5-0.8B` не вернул одну публикацию за 300 секунд;
  это не оценка качества модели, но этот runtime не подходит для интерактивного demo.

## Решения API v0.4.0

- HTTP-пути используют существительные: `/analyses`, `/decisions`, `/collections`,
  `/lifecycle-events`.
- Импорт воспроизводимых данных отделён от бизнес-API: `POST /api/demo/seed`.
- Сбор пока синхронный и возвращает `CollectionReport`. Фиктивного `job_id` нет.
- `already_seen` в отчёте — повторно увиденный ID/URL, `content_duplicates` —
  совпавший SHA-256 текста; deprecated `exact_duplicates` равен их сумме.
- В JSON используются `Publication`, `AnalysisVersion`, `regulatory_case` и
  `occurred_at`; nullable-поля ответа присутствуют явно со значением `null`.
- OpenAPI — единственный источник истины. Frontend `schema.d.ts` генерируется из
  `contracts/openapi.yaml`.
- `PublicationRevision` и `DuplicateReview` сохраняют ручные изменения append-only.
- `/duplicates` показывает semantic candidates и принимает вердикты
  `duplicate/related/different` без автоматической склейки.
- Массовый semantic backfill кэширует векторы по publication, model и content hash;
  кэш ускоряет повторный запуск, но не является пользовательским решением.
- Lifecycle принимает только официальные `regulator` и `official_publication`;
  матрица переходов зафиксирована в `rules.md`.
- Важность описывают шесть именованных критериев; backend рассчитывает
  `importance_score` 0–18 и `proposed_priority`. Неизвестный фактор — `null`, а не
  ноль. Четыре именованных hard signal включают обязательную проверку.
- Периодический collector запускается каждые 30 минут и выполняет первый проход
  сразу после старта.

## Выводы

- Модульный FastAPI-монолит + SQLite достаточны для проверяемого hackathon MVP и не
  мешают позже заменить хранилище или inference adapter.
- Синхронный сбор честнее текущей реализации: клиент сразу получает измеримый итог,
  а асинхронность стоит вводить только вместе с очередью и endpoint статуса.
- На дешёвом CPU VPS web/API/collector остаются локальными, а live LLM вызывается
  через OpenAI-compatible inference endpoint. Это сохраняет один контракт анализа.
- Live LLM проходит server-side guardrails: 3-5 предложений, grounded evidence и
  фактическое сжатие материалов от 500 символов; replay-данные не считаются замером.

## Гипотезы

- Объяснимая очередь с human-in-the-loop уменьшит время утреннего разбора без
  сокрытия критичных сигналов.
- Равные веса и границы 0/5/10/15 пригодны как прозрачная MVP-гипотеза, но требуют
  продуктовой валидации на независимой разметке.
- Порог cosine similarity можно выбрать только после разметки duplicate/non-duplicate
  пар; до этого similarity не является автоматическим решением.

## Открытые вопросы

- Независимая валидация принятой MVP-методики важности и порогов.
- Независимо размеченный quality eval-набор и измеренные quality/latency показатели.
- URL Правового комитета АРПП и HTML/full-text adapters официальных регуляторов.
- Сроки хранения и архивирования lifecycle-истории.
- Редактирование кейсов НПА, server-side digest API и доставка дайджеста в Telegram.
- Независимая разметка реальных duplicate/related/different пар для production
  threshold.
