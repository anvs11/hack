# Production VPS smoke v1

Дата: 2026-09-05 12:40 MSK. Полные измерения сохранены в `report.json`.

## Результат

- Публичный URL отвечает по HTTPS с сертификатом Let's Encrypt.
- 13/13 live-источников собраны: первый проход создал 310 публикаций из 311 записей.
- Немедленный повтор создал 0 публикаций: 310 записей совпали по ID/URL, одна — по
  нормализованному тексту.
- `qwen/qwen3.8-flash` создал одну валидную immutable-версию анализа за 6.00116 с;
  две дословные цитаты прошли проверку. Это smoke одной карточки, не benchmark качества
  и не подтверждённый SLA.
- Synthetic Telegram `initData` прошёл серверную проверку подписи, а глобальная кнопка
  меню бота указывает на production HTTPS URL.
- Ручное создание, редактирование, скрытие и чтение истории публикации проверены через
  API; smoke-карточка скрыта из основной ленты.
- Docker включён при старте ОС, три долгоживущих контейнера используют
  `restart=unless-stopped`, collector запущен с интервалом 1800 секунд.
- После проверки повторного входа по ключу SSH password/keyboard-interactive login
  отключён; root допускается только по public key.

## Команды проверки

```bash
curl -fsS https://regradar-demo.209-250-246-26.sslip.io/api/health
curl -fsS https://regradar-demo.209-250-246-26.sslip.io/api/sources
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
docker compose --env-file deploy/.env -f deploy/compose.yaml logs --tail=100 backend collector web
```

## Ограничения

Первый live-запрос с лимитом 512 output tokens не прошёл schema validation. После
увеличения deployment-лимита до 1024 запрос прошёл; независимой серии ещё нет. Для
Telegram остаётся ручной запуск внутри мобильного клиента. Автозапуск проверен по
конфигурации systemd/Docker, но VPS намеренно не перезагружался во время smoke.
