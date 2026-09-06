import { expect, test } from '@playwright/test'

const publicationTitle = 'Проект требований к обработке данных вынесен на обсуждение'
const excludedPublicationTitle = 'ИТ-компания объявила о запуске образовательной программы'
const caseTitle = 'Демонстрационные требования к обработке данных'
const decisionComment = 'B8 E2E: критический приоритет подтверждён'
const lifecycleComment = 'B8 E2E: начальная стадия подтверждена'
const confirmationUrl = 'https://regulation.gov.ru/e2e/case-001'

test('isolated real API: решение и lifecycle отражаются в дайджесте', async ({ page }) => {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const digestApiRequests: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname
    if (pathname === '/api/digest' || pathname.startsWith('/api/digest/')) {
      digestApiRequests.push(request.url())
    }
  })

  try {
    await page.goto('/feed')
    await expect(page.getByRole('heading', { name: /Мониторинг/ })).toBeVisible()
    await expect(page.getByLabel('10 публикаций')).toBeVisible()
    await expect(page.getByRole('link', { name: publicationTitle, exact: true })).toBeVisible()

    await page.getByLabel('AI-приоритет').selectOption('high')
    await expect(page).toHaveURL(/(?:\?|&)proposed_priority=high(?:&|$)/)
    await expect(page.getByText('Активно: 1')).toBeVisible()
    await expect(page.getByRole('link', { name: publicationTitle, exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: excludedPublicationTitle, exact: true })).toHaveCount(0)

    await page.getByRole('link', { name: publicationTitle, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: publicationTitle, exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Подробно', exact: true }).click()
    await expect(page.getByText('AI-приоритет · Высокий', { exact: true })).toBeVisible()
    await page.locator('.history-disclosure > summary').click()
    await expect(page.getByText('1 AI · 0 решений', { exact: false }).first()).toBeVisible()
    await expect(page.getByText('Решений специалиста ещё нет.')).toBeVisible()

    await page.getByLabel('Финальный приоритет').selectOption('critical')
    await page.getByLabel('Комментарий · необязательно').fill(decisionComment)
    await Promise.all([
      page.waitForResponse((response) =>
        response.url().endsWith('/api/publications/pub-001/decisions') &&
        response.request().method() === 'POST' && response.status() === 201,
      ),
      page.getByRole('button', { name: 'Сохранить решение' }).click(),
    ])

    await expect(page.getByRole('status').filter({ hasText: 'Решение специалиста сохранено в истории.' })).toBeVisible()
    const latestDecision = page.locator('.latest-decision')
    await expect(latestDecision).toContainText('Скорректировано')
    await expect(latestDecision).toContainText('Финальный приоритетКритический')
    await expect(latestDecision).toContainText(decisionComment)
    await expect(page.getByText('1 AI · 1 решений', { exact: false }).first()).toBeVisible()
    await expect(page.locator('.decision-history-list')).toContainText(decisionComment)
    await expect(page.getByText('AI-приоритет · Высокий', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Добавить в досье' }).click()
    const dialog = page.getByRole('dialog', { name: 'Добавить публикацию в досье документа' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('radio', { name: new RegExp(`${caseTitle}.*DEMO-2026-001`) }).check()
    await Promise.all([
      page.waitForResponse((response) =>
        response.url().endsWith('/api/regulatory-cases/case-001/publications/pub-001') &&
        response.request().method() === 'PUT' && response.status() === 204,
      ),
      dialog.getByRole('button', { name: 'Подтвердить привязку' }).click(),
    ])
    await expect(dialog.getByRole('status')).toHaveText('Публикация добавлена в досье документа.')
    await expect(dialog.getByText('Уже привязана')).toBeVisible()
    await dialog.getByRole('button', { name: 'Закрыть диалог' }).click()
    await expect(dialog).toBeHidden()

    const navigation = page.getByRole('navigation', { name: 'Основные разделы' })
    await navigation.getByRole('link', { name: 'Нормативные документы' }).click()
    await page.getByRole('link', { name: caseTitle, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: caseTitle })).toBeVisible()
    await expect(page.locator('.stage-card')).toContainText('Текущая стадияПроект')
    await expect(page.getByText('Событий пока нет')).toBeVisible()
    await expect(page.getByRole('link', { name: publicationTitle, exact: true })).toBeVisible()

    await page.getByLabel('Стадия').selectOption('draft')
    await page.getByLabel('Дата события').fill('2026-09-04T12:00')
    await page.getByLabel('Ссылка на официальное подтверждение').fill(confirmationUrl)
    await page.getByLabel('Тип официального источника').selectOption('regulator')
    await page.getByLabel('Комментарий · необязательно').fill(lifecycleComment)
    await Promise.all([
      page.waitForResponse((response) =>
        response.url().endsWith('/api/regulatory-cases/case-001/lifecycle-events') &&
        response.request().method() === 'POST' && response.status() === 201,
      ),
      page.getByRole('button', { name: 'Добавить событие' }).click(),
    ])

    await expect(page.getByRole('status').filter({ hasText: 'Официальное событие добавлено.' })).toBeVisible()
    const timeline = page.getByRole('list', { name: 'Хронология' })
    await expect(timeline.getByRole('listitem')).toHaveCount(1)
    await expect(timeline).toContainText('Проект')
    await expect(timeline).toContainText(lifecycleComment)
    await expect(timeline).toContainText('user-gr-001')
    await expect(timeline).toContainText(/4 сент.*2026.*12:00/)
    await expect(timeline.getByRole('link', { name: 'Официальное подтверждение' })).toHaveAttribute('href', confirmationUrl)
    await expect(page.locator('.stage-card')).toContainText('Текущая стадияПроект')

    await navigation.getByRole('link', { name: /Отчёт/ }).click()
    await page.getByRole('link', { name: 'Автоматическая сводка', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Дайджест для руководителя' })).toBeVisible()
    await expect(page.getByText('Сформирован', { exact: true })).toBeVisible()

    const counters = page.getByRole('group', { name: 'Сводные счётчики' })
    for (const [label, count] of [
      ['Критические', '1'],
      ['Изменения документов', '1'],
      ['На проверке', '6'],
      ['Действия', '2'],
    ] as const) {
      await expect(counters.getByText(label).locator('..')).toContainText(`${label}${count}`)
    }

    const criticalSection = page.getByRole('region', { name: 'Подтверждённые критические материалы' })
    const lifecycleSection = page.getByRole('region', { name: 'Изменения нормативных документов' })
    const reviewSection = page.getByRole('region', { name: 'Требующие проверки карточки' })
    const actionsSection = page.getByRole('region', { name: 'Действия пользователей' })
    await expect(criticalSection).toBeVisible()
    await expect(lifecycleSection).toBeVisible()
    await expect(reviewSection).toBeVisible()
    await expect(actionsSection).toBeVisible()
    await expect(criticalSection).toContainText(publicationTitle)
    await expect(criticalSection).toContainText('Скорректировано')
    await expect(criticalSection).toContainText('ПриоритетКритический')
    await expect(lifecycleSection).toContainText(caseTitle)
    await expect(lifecycleSection).toContainText('Зафиксирована начальная стадия — Проект')
    await expect(lifecycleSection).toContainText(lifecycleComment)
    await expect(actionsSection).toContainText(decisionComment)
    await expect(actionsSection).toContainText(lifecycleComment)
  } finally {
    expect.soft(consoleErrors, 'console errors').toEqual([])
    expect.soft(pageErrors, 'page errors').toEqual([])
    expect.soft(digestApiRequests, 'requests to the nonexistent digest API').toEqual([])
  }
})
