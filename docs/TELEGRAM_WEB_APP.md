# Запуск настоящего Telegram Mini App

Статус: bot token проверен, backend принимает корректно подписанный `initData`; для
реального запуска остался публичный HTTPS URL и настройка BotFather. Локальная страница `127.0.0.1` не получает подписанный
`Telegram.WebApp.initData` и поэтому не является полноценным тестом Mini App.

## Что уже реализовано

- официальный Telegram Web App SDK загружается неблокирующе;
- frontend вызывает `ready()`, раскрывает WebView и учитывает viewport/safe area/theme;
- на вложенных страницах используется нативная кнопка Back;
- raw `initData` отправляется в `POST /api/auth/telegram`;
- backend проверяет HMAC-подпись и возраст `auth_date`;
- после проверки в шапке появляется `Telegram · <имя>`;
- действия пользователя записываются с `author_id=telegram:<id>` вместо demo ID;
- если SDK загрузился после React, handshake всё равно запускается.

## Что нужно сделать один раз

1. Бот `@reg_radar_product_hack_bot` уже создан и проверен через Telegram `getMe`.
2. Token хранить только в git-ignored deployment secret и передавать backend через
   `HACK_TELEGRAM_BOT_TOKEN`; не коммитить и не писать его в документацию.
3. Создать CPU VPS с публичным IPv4, направить на него домен или адрес вида
   `hack.<IP-с-дефисами>.sslip.io` и записать hostname в `APP_DOMAIN`.
4. Запустить `deploy/compose.yaml`. Caddy автоматически получает TLS-сертификат и
   проксирует `/api/*` в FastAPI.lj,fd
5. Проверить `https://<APP_DOMAIN>/api/health`.
6. В `@BotFather`: `/mybots` → выбрать бота → `Bot Settings` →
   `Configure Mini App` / `Menu Button` → указать тот же HTTPS URL.
7. Открыть профиль бота и нажать `Launch app` или кнопку меню.

Telegram официально требует передавать `Telegram.WebApp.initData` на backend и
проверять его там. Menu Button можно настроить через BotFather командой
`/setmenubutton`; Main Mini App также настраивается через BotFather:

- <https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app>
- <https://core.telegram.org/bots/webapps#launching-mini-apps-from-the-menu-button>

## Smoke-test внутри Telegram

1. В шапке виден зелёно-синий статус `Telegram · <имя>`, а не красный отказ.
2. Открытие публикации показывает нативную кнопку Back.
3. Ручная публикация, решение по дублю или правка карточки получают автора
   `telegram:<ваш id>`.
4. После перезапуска страницы лента и история остаются на месте.
5. `POST /api/auth/telegram` с изменённым или устаревшим `initData` возвращает 401.

## Ограничение MVP

**Факт:** подпись запуска проверяется, но остальные write-endpoints пока не требуют
серверную session cookie/JWT. Для четырёхдневного закрытого hackathon demo это
осознанное ограничение, а не production-аутентификация. Если публичную ссылку будут
распространять вне команды, следующим шагом нужно выдавать короткую серверную сессию
после Telegram handshake и защищать все операции записи.
