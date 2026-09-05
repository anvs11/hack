# Telegram auth plumbing smoke v1

Дата: 2026-09-05
Статус: backend-проверка токена и подписи пройдена; запуск внутри Telegram ещё не
проверен без публичного HTTPS URL.

## Результат

- Telegram `getMe` подтвердил бота `@reg_radar_product_hack_bot` (`RegRadar`);
- token хранится в git-ignored файле с правами `0600`;
- backend перезапущен с token из файла;
- синтетический, корректно подписанный `initData` вернул HTTP 200;
- response содержит `authenticated=true`, ожидаемый user ID и query ID;
- `telegram_auth_unavailable` больше не возникает в текущем локальном backend.

Token и подписанная строка в артефакт не записаны. Для полного smoke остаются
публичный HTTPS URL, настройка BotFather Menu Button и запуск внутри Telegram-клиента.
