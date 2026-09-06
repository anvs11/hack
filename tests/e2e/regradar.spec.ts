import { expect, test } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
const screenshots = '/tmp/regradar-screenshots'
const title = 'Проект требований к обработке данных вынесен на обсуждение'

test('responsive controls, full first card at 1280, no overflow at requested sizes', async ({
  page,
}) => {
  await mkdir(screenshots, { recursive: true })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [768, 1024],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height })
    await page.goto('/feed')
    await expect(page.locator('.publication-card').first()).toBeVisible()
    await expect(page.getByLabel('Поиск по ленте')).toBeVisible()
    await expect(page.getByLabel('Категория', { exact: true })).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      `${width}: overflow`,
    ).toBe(false)
    await page.screenshot({ path: `${screenshots}/monitor-${width}.png` })
    if (width === 1280) {
      const card = await page.locator('.publication-card').first().boundingBox()
      expect(card!.y + card!.height, 'full first card').toBeLessThanOrEqual(
        height,
      )
    }
    if (width < 1100)
      await expect(
        page.getByRole('button', { name: 'Раскрыть карту', exact: true }),
      ).toBeVisible()
    else await expect(page.locator('.map-node').first()).toBeVisible()
    await page.screenshot({ path: `${screenshots}/monitor-${width}.png` })
  }
  expect(errors).toEqual([])
})

test('URL filters, last day, pagination, Back/Forward and scrolled result restoration', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/feed?limit=5')
  await expect(page.locator('.publication-card')).toHaveCount(5)
  await page.getByRole('button', { name: 'Далее →' }).click()
  await expect(page).toHaveURL(/offset=5/)
  await page.goBack()
  await expect(page).not.toHaveURL(/offset=/)
  await page.goForward()
  await expect(page).toHaveURL(/offset=5/)
  await expect(page.locator('.publication-card')).toHaveCount(5)
  await page.evaluate(() => document.fonts.ready)
  const card = page.locator('.publication-card').nth(2)
  await card.scrollIntoViewIfNeeded()
  const before = await page.evaluate(() => scrollY)
  const returnUrl = page.url()
  await card.getByRole('link', { name: 'Открыть анализ' }).click()
  await expect(page).toHaveURL(/\/publications\//)
  await expect(
    page.locator('.publication-workspace').getByRole('button', { name: /В отч/ }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Вернуться к результатам' }).click()
  await expect(page).toHaveURL(returnUrl)
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(before, -1)
  await page.getByLabel('Категория', { exact: true }).selectOption('regulation')
  await expect(page).not.toHaveURL(/offset=/)
  await page.getByRole('button', { name: 'Удалить фильтр Категория' }).click()
  await expect(page).not.toHaveURL(/category=/)
  await page.getByLabel('Дата с', { exact: true }).fill('2026-09-01')
  await page.getByLabel('Дата по', { exact: true }).fill('2026-09-01')
  const params = new URL(page.url()).searchParams
  expect(
    Date.parse(params.get('published_to')!) -
      Date.parse(params.get('published_from')!),
  ).toBe(86_399_999)
  await page.getByLabel('Дата с', { exact: true }).fill('2026-09-03')
  await expect(page.getByRole('alert')).toContainText('не позже окончания')
})

test('manual report: deduplication, order, reload, new AI snapshot, downloads and print', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/publications/pub-001')
  await page
    .getByRole('button', { name: 'Сохранить решение', exact: true })
    .click()
  await expect(
    page.getByText('Решение специалиста сохранено в истории.'),
  ).toBeVisible()
  await page
    .getByRole('link', { name: 'Вернуться к результатам', exact: true })
    .click()
  await page
    .getByRole('checkbox', { name: `Выбрать: ${title}`, exact: true })
    .check()
  await page.locator('.publication-card').nth(1).getByRole('checkbox').check()
  await page.getByRole('button', { name: /В отчёт \(2\)/ }).click()
  const nav = page.getByRole('navigation', { name: 'Основные разделы' })
  await expect(nav.getByRole('link', { name: 'Отчёт 2' })).toBeVisible()
  await page
    .getByRole('checkbox', { name: `Выбрать: ${title}`, exact: true })
    .check()
  await page.getByRole('button', { name: /В отчёт \(1\)/ }).click()
  await nav.getByRole('link', { name: 'Отчёт 2' }).click()
  await page
    .getByLabel('Название отчёта')
    .fill('Регуляторная повестка — сентябрь')
  await page
    .getByLabel('Краткое резюме отчёта')
    .fill('Два материала для обсуждения на встрече.')
  const first = page.getByRole('article', {
    name: `Материал отчёта: ${title}`,
    exact: true,
  })
  await first
    .getByLabel('Комментарий для менеджера')
    .fill('Проверить применимость к нашему продукту.')
  if (
    await first
      .getByRole('button', { name: `Ниже: ${title}`, exact: true })
      .isDisabled()
  )
    await first
      .getByRole('button', { name: `Выше: ${title}`, exact: true })
      .click()
  await first
    .getByRole('button', { name: `Ниже: ${title}`, exact: true })
    .click()
  await expect(page.locator('.report-item').nth(1)).toContainText(title)
  await page.reload()
  await expect(page.getByLabel('Название отчёта')).toHaveValue(
    'Регуляторная повестка — сентябрь',
  )
  await expect(first.getByLabel('Комментарий для менеджера')).toHaveValue(
    'Проверить применимость к нашему продукту.',
  )
  const oldId = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.startsWith('regradar:report:v1:'),
    )!
    return JSON.parse(localStorage.getItem(key)!).items.find(
      (i: { id: string }) => i.id === 'pub-001',
    ).detail.latest_analysis.id
  })
  await first.getByRole('link', { name: title, exact: true }).click()
  const analysisResponse = await page.request.post(
    'http://127.0.0.1:8000/api/publications/pub-001/analyses',
    { data: { analyzer: 'replay' } },
  )
  expect(analysisResponse.status()).toBe(201)
  await page.reload()
  await expect(
    page.getByText('Решение относится к предыдущей версии анализа', {
      exact: false,
    }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Обновить снимок в отчёте', exact: true }),
  ).toBeVisible()
  await page
    .getByRole('link', { name: 'Вернуться в отчёт', exact: true })
    .click()
  await expect(
    first.getByRole('button', { name: 'Обновить снимок', exact: true }),
  ).toBeVisible()
  const jsonWait = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Скачать JSON' }).click()
  const json = JSON.parse(
    await readFile((await (await jsonWait).path())!, 'utf8'),
  )
  expect(json.brand).toBe('RegRadar')
  expect(json.items).toHaveLength(2)
  expect(new Set(json.items.map((i: { id: string }) => i.id)).size).toBe(2)
  expect(
    json.items.find((i: { id: string }) => i.id === 'pub-001').detail
      .latest_analysis.id,
  ).toBe(oldId)
  await first
    .getByRole('button', { name: 'Обновить снимок', exact: true })
    .click()
  await expect(first.getByLabel('Комментарий для менеджера')).toHaveValue(
    'Проверить применимость к нашему продукту.',
  )
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${screenshots}/report-desktop.png` })
  for (const [width, height] of [
    [1280, 720],
    [768, 1024],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({ path: `${screenshots}/report-${width}.png` })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  const mdWait = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Скачать Markdown' }).click()
  const md = await readFile((await (await mdWait).path())!, 'utf8')
  expect(md).toContain('RegRadar')
  expect(md).toContain('Проверить применимость')
  expect(md).toContain('Предыдущая версия')
  await page.getByRole('link', { name: 'Просмотр', exact: false }).click()
  await expect(
    page.getByRole('region', { name: 'Предпросмотр отчёта' }),
  ).toContainText('Регуляторная повестка — сентябрь')
  await page.screenshot({ path: `${screenshots}/report-preview.png` })
  await page.emulateMedia({ media: 'print' })
  await expect(nav).toBeHidden()
  await expect(
    page.getByRole('button', { name: 'Печать / сохранить PDF' }),
  ).toBeHidden()
  await expect(page.locator('.report-preview')).toBeVisible()
  await page.pdf({ path: `${screenshots}/RegRadar-print.pdf`, format: 'A4' })
})

test('map keyboard navigation, linked card, context loss and 2D fallback', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/feed')
  const node = page.getByRole('link', {
    name: `На карте: ${title}`,
    exact: true,
  })
  await node.focus()
  await expect(page.locator('#publication-pub-001')).toHaveClass(/highlighted/)
  await node.press('Enter')
  await expect(
    page.getByRole('heading', { level: 1, name: title }),
  ).toBeVisible()
  await page.screenshot({ path: `${screenshots}/analysis-desktop.png` })
  await page.getByRole('link', { name: 'Вернуться к результатам' }).click()
  await expect(page.locator('.signal-stage canvas')).toBeVisible()
  await page
    .locator('.signal-stage canvas')
    .evaluate((canvas) =>
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })),
    )
  await expect(page.getByText('2D-карта · WebGL недоступен')).toBeVisible()
  await expect(node).toBeVisible()
  await node.press('Enter')
  await expect(page).toHaveURL(/publications\/pub-001/)
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      type: string,
      ...args: unknown[]
    ) {
      if (type === 'webgl') return null
      return original.apply(this, [type, ...args] as Parameters<
        typeof original
      >)
    } as typeof original
  })
  await page.goto('/feed')
  await expect(page.getByText('2D-карта · WebGL недоступен')).toBeVisible()
  await page.getByRole('button', { name: 'Пауза', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Повернуть карту влево' }),
  ).toBeDisabled()
})

test('research, sources, cases and automatic summary remain responsive', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [768, 1024],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height })
    for (const route of [
      '/publications/pub-001',
      '/sources',
      '/regulatory-cases',
      '/regulatory-cases/case-001',
      '/digest?tab=auto',
    ]) {
      await page.goto(route)
      await expect(page.locator('h1')).toBeVisible()
      await expect(page.locator('.page-state-loading')).toHaveCount(0)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${route} at ${width}`,
      ).toBe(true)
      if (route.startsWith('/publications/'))
        await page.screenshot({ path: `${screenshots}/analysis-${width}.png` })
    }
  }
  expect(errors).toEqual([])
})

test('3D map supports drag, wheel, pan, keyboard, fullscreen and real node clicks', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/feed')
  await page.evaluate(() => document.fonts.ready)
  const node = page.getByRole('link', {
    name: `На карте: ${title}`,
    exact: true,
  })
  await expect(node).toBeVisible()
  const before = await node.getAttribute('style')
  const box = await node.boundingBox()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + 75, box!.y + 55, { steps: 10 })
  await page.mouse.up()
  await expect(page).toHaveURL(/\/feed$/)
  await expect.poll(() => node.getAttribute('style')).not.toBe(before)
  await page.getByRole('button', { name: 'Сброс вида', exact: true }).click()
  await expect(page.getByLabel('Масштаб карты')).toHaveText('100%')
  const stage = page.getByRole('group', { name: 'Область 3D-карты' })
  const area = await stage.boundingBox()
  await page.mouse.move(area!.x + 25, area!.y + 25)
  const scrollBefore = await page.evaluate(() => scrollY)
  await page.mouse.wheel(0, -240)
  await expect
    .poll(async () =>
      Number(
        (await page.getByLabel('Масштаб карты').textContent())!.replace(
          '%',
          '',
        ),
      ),
    )
    .toBeGreaterThan(100)
  expect(await page.evaluate(() => scrollY)).toBe(scrollBefore)
  const beforePan = await node.getAttribute('style')
  await page.keyboard.down('Shift')
  await page.mouse.down()
  await page.mouse.move(area!.x + 65, area!.y + 60, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect.poll(() => node.getAttribute('style')).not.toBe(beforePan)
  await stage.focus()
  const beforeKeyboard = await node.getAttribute('style')
  await stage.press('ArrowUp')
  await expect.poll(() => node.getAttribute('style')).not.toBe(beforeKeyboard)
  await stage.press('0')
  await expect(page.getByLabel('Масштаб карты')).toHaveText('100%')
  await page
    .getByRole('button', { name: 'Развернуть карту на весь экран' })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Карта сигналов' })
  await expect(dialog).toBeVisible()
  expect(await page.locator('#root').evaluate((el) => el.inert)).toBe(true)
  await dialog.getByRole('button', { name: 'Приблизить карту' }).click()
  await expect(dialog.getByLabel('Масштаб карты')).toHaveText('120%')
  await dialog.getByRole('button', { name: 'Сброс вида', exact: true }).click()
  await page.screenshot({ path: `${screenshots}/graph-desktop.png` })
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Развернуть карту на весь экран' }),
  ).toBeFocused()
  expect(await page.locator('#root').evaluate((el) => el.inert)).toBe(false)
  await node.click()
  await expect(
    page.getByRole('heading', { level: 1, name: title }),
  ).toBeVisible()
})

test('Mini App layout supports touch rotation, pinch, safe areas and restores Telegram swipes', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  })
  const page = await context.newPage()
  try {
    await page.route('https://telegram.org/js/**', (route) =>
      route.fulfill({ body: '', contentType: 'application/javascript' }),
    )
    // SDK harness only. It does not fabricate a successful Telegram authentication.
    await page.addInitScript(() => {
      const app = {
        initData: '',
        viewportHeight: 844,
        viewportStableHeight: 844,
        contentSafeAreaInset: { top: 24, right: 0, bottom: 20, left: 0 },
        isVerticalSwipesEnabled: true,
        disableVerticalSwipes() {
          this.isVerticalSwipesEnabled = false
        },
        enableVerticalSwipes() {
          this.isVerticalSwipesEnabled = true
        },
        ready() {},
        expand() {},
        onEvent() {},
        offEvent() {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      }
      Object.assign(window, { Telegram: { WebApp: app } })
    })
    await page.goto('http://127.0.0.1:5173/feed?tgWebAppPlatform=ios')
    await expect(page.locator('.publication-card').first()).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    expect(
      await page.evaluate(() => getComputedStyle(document.body).fontFamily),
    ).toContain('Gilroy')
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    const nav = page.getByRole('navigation', { name: 'Основные разделы' })
    const navBox = await nav.boundingBox()
    expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(844)
    await page.screenshot({ path: `${screenshots}/mini-app-feed.png` })
    await page
      .getByRole('button', { name: 'Раскрыть карту', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Развернуть карту на весь экран' })
      .click()
    const dialog = page.getByRole('dialog', { name: 'Карта сигналов' })
    await expect(dialog).toBeVisible()
    const swipeState = () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              Telegram: { WebApp: { isVerticalSwipesEnabled: boolean } }
            }
          ).Telegram.WebApp.isVerticalSwipesEnabled,
      )
    expect(await swipeState()).toBe(false)
    const stage = dialog.getByRole('group', { name: 'Область 3D-карты' })
    const box = await stage.boundingBox()
    const x = box!.x + box!.width / 2,
      y = box!.y + box!.height / 2
    const cdp = await context.newCDPSession(page)
    const node = dialog.getByRole('link', {
      name: `На карте: ${title}`,
      exact: true,
    })
    const before = await node.getAttribute('style')
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: 1 }],
    })
    for (let i = 1; i <= 6; i++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + i * 8, y: y + i * 5, id: 1 }],
      })
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
    await expect.poll(() => node.getAttribute('style')).not.toBe(before)
    await dialog
      .getByRole('button', { name: 'Сброс вида', exact: true })
      .click()
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: x - 35, y, id: 1 },
        { x: x + 35, y, id: 2 },
      ],
    })
    for (let i = 1; i <= 6; i++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: x - 35 - i * 5, y, id: 1 },
          { x: x + 35 + i * 5, y, id: 2 },
        ],
      })
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
    await expect
      .poll(async () =>
        Number(
          (await dialog.getByLabel('Масштаб карты').textContent())!.replace(
            '%',
            '',
          ),
        ),
      )
      .toBeGreaterThan(150)
    await dialog
      .getByRole('button', { name: 'Сброс вида', exact: true })
      .click()
    await page.screenshot({ path: `${screenshots}/graph-mobile.png` })
    const close = dialog.getByRole('button', {
      name: 'Закрыть полноэкранную карту',
    })
    const closeBox = await close.boundingBox()
    expect(closeBox!.y).toBeGreaterThanOrEqual(24)
    await close.click()
    await expect(dialog).toHaveCount(0)
    expect(await swipeState()).toBe(true)
    await expect(nav).toBeVisible()
  } finally {
    await context.close()
  }
})
