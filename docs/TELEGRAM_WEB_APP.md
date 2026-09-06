# Запуск настоящего Telegram Mini App

Статус: production HTTPS и Menu Button настроены; backend принимает корректно
подписанный `initData`. Локальная страница `127.0.0.1` не получает подписанный
`Telegram.WebApp.initData` и поэтому не является полноценным тестом Mini App.

## Что уже реализовано

- официальный Telegram Web App SDK загружается неблокирующе;
- frontend вызывает `ready()`, раскрывает WebView и учитывает viewport/safe area/theme;
- на вложенных страницах используется нативная кнопка Back;
- raw `initData` отправляется в `POST /api/auth/telegram` и заголовке
  `X-Telegram-Init-Data` на персональные и защищённые действия;
- backend проверяет HMAC-подпись и возраст `auth_date`;
- после проверки в шапке появляется `Telegram · <имя>`;
- действия пользователя записываются с `author_id=telegram:<id>` вместо demo ID;
- профиль хранит Telegram ID, имя, username, роль, личный режим отображения,
  стартовые фильтры и разрешения;
- кнопка отчёта вызывает `POST /api/telegram/report-deliveries`, а backend отправляет
  текст прямо в личный чат пользователя с ботом;
- `GET/PATCH /api/me/telegram-digest-settings` управляет автоматической доставкой;
- после каждого 15-минутного цикла worker отправляет только новые релевантные
  AI-анализы и записывает доставленные версии, чтобы не повторять сообщения;
- если SDK загрузился после React, handshake всё равно запускается.

## Что нужно сделать один раз

1. Бот `@reg_radar_product_hack_bot` уже создан и проверен через Telegram `getMe`.
2. Token хранить только в git-ignored deployment secret и передавать backend через
   `HACK_TELEGRAM_BOT_TOKEN`; не коммитить и не писать его в документацию.
3. CPU VPS и публичный hostname уже созданы; актуальное значение хранится в
   deployment-конфигурации, а не в frontend-коде.
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
6. В разделе «Отчёт» кнопка «Отправить в Telegram» доставляет сообщение в чат;
   пользователь до этого должен хотя бы один раз открыть/запустить бота.
7. В том же разделе включить автоотчёт, выбрать минимальный приоритет и убедиться,
   что следующий новый релевантный анализ приходит один раз.

## Ограничение MVP

**Факт:** профиль, подтверждение анализа и отправка отчёта используют проверенный
`initData`, но остальные write-endpoints пока не требуют серверную session cookie/JWT.
Для четырёхдневного закрытого hackathon demo это осознанное ограничение, а не
production-аутентификация. Перед публичным распространением нужен короткий
server-side сеанс после Telegram handshake и единая защита всех операций записи.
