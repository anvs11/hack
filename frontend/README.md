# Frontend аналитического центра Insight

React + Vite + TypeScript интерфейс PR/GR-аналитического центра. Frontend
использует React Router, типизированный API-клиент и MSW для автономного
demo-режима.

## Обязательная инструкция по интерфейсу

Перед созданием или изменением любого экрана полностью прочитайте
[`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md). Новые функции должны продолжать
зафиксированную дизайн-систему, адаптивность, анимационную механику и требования
доступности.

## Локальный запуск

Из корня репозитория:

```bash
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173
```

Приложение доступно по адресу `http://127.0.0.1:5173`.

## Проверки

```bash
npm --prefix frontend run generate:api
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run test -- --run
npm --prefix frontend run build
```

`schema.d.ts` генерируется из `../contracts/openapi.yaml` и не редактируется
вручную.
