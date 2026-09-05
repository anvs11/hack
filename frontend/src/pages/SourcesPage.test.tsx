import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { createTestRouter } from '../app/router'
import { sources } from '../mocks/fixtures'
import type {
  CollectionReport,
  Source,
  SourceCreate,
  SourcePatch,
} from '../shared/api/types'
import { formatDate } from '../shared/format'
import { server } from '../test/setup'

function renderSources() {
  render(<RouterProvider router={createTestRouter('/sources')} />)
}

async function sourceCard(name: string) {
  const heading = await screen.findByRole('heading', { name })
  const card = heading.closest('article')
  expect(card).not.toBeNull()
  return card as HTMLElement
}

function fillCreateForm() {
  fireEvent.change(screen.getByLabelText('Название'), {
    target: { value: '  Новая RSS-лента  ' },
  })
  fireEvent.change(screen.getByLabelText('Тип'), { target: { value: 'telegram' } })
  fireEvent.change(screen.getByLabelText('URL'), {
    target: { value: 'https://example.org/new-source' },
  })
}

describe('sources list states', () => {
  it('renders the source details and active counter', async () => {
    renderSources()

    expect(await screen.findByText('Портал проектов НПА (demo)')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getAllByText('Активен')).toHaveLength(5)
    expect(screen.getAllByText('Сайт регулятора', { exact: false })).toHaveLength(2)
    expect(screen.getByRole('link', { name: /https:\/\/regulation\.gov\.ru/ })).toHaveAttribute(
      'href',
      'https://regulation.gov.ru/',
    )
  })

  it('shows loading, empty and GET error states', async () => {
    server.use(http.get('*/api/sources', async () => {
      await delay('infinite')
      return HttpResponse.json([])
    }))
    renderSources()
    expect(screen.getByRole('status')).toHaveTextContent('Загружаем источники')
  })

  it('shows an honest empty state', async () => {
    server.use(http.get('*/api/sources', () => HttpResponse.json([])))
    renderSources()
    expect(await screen.findByRole('heading', { name: 'Источников нет' })).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('shows a GET error as a page-level alert', async () => {
    server.use(http.get('*/api/sources', () =>
      HttpResponse.json({ message: 'Список недоступен' }, { status: 503 }),
    ))
    renderSources()
    expect(await screen.findByRole('alert')).toHaveTextContent('Список недоступен')
  })

  it('shows last success and last error independently with clear null values', async () => {
    const sourceWithError = {
      ...sources[0],
      last_error: 'Временная ошибка сети',
    } satisfies Source
    const neverRun = {
      ...sources[1],
      id: 'never-run',
      name: 'Новый источник',
      last_checked_at: null,
      last_success_at: null,
      last_error: null,
    } satisfies Source
    server.use(http.get('*/api/sources', () => HttpResponse.json([sourceWithError, neverRun])))
    renderSources()

    const erroredCard = await sourceCard(sourceWithError.name)
    expect(within(erroredCard).getAllByText(formatDate(sourceWithError.last_success_at!))).toHaveLength(2)
    expect(within(erroredCard).getByText('Временная ошибка сети')).toBeInTheDocument()
    const neverRunCard = await sourceCard(neverRun.name)
    expect(within(neverRunCard).getByText('Ещё не запускался')).toBeInTheDocument()
    expect(within(neverRunCard).getByText('Успешных обновлений ещё не было')).toBeInTheDocument()
    expect(within(neverRunCard).getByText('Ошибок нет')).toBeInTheDocument()
  })
})

describe('source create and edit dialogs', () => {
  it('creates from the exact payload, blocks a double submit and updates the count', async () => {
    let received: SourceCreate | null = null
    let calls = 0
    server.use(http.post('*/api/sources', async ({ request }) => {
      calls += 1
      received = await request.json() as SourceCreate
      await delay(80)
      return HttpResponse.json({
        ...received,
        id: 'source-created',
        enabled: received.enabled ?? true,
        last_checked_at: null,
        last_success_at: null,
        last_error: null,
        is_demo: false,
      } satisfies Source, { status: 201 })
    }))
    renderSources()
    await screen.findByText(sources[0].name)
    fireEvent.click(screen.getByRole('button', { name: 'Добавить источник' }))
    fillCreateForm()

    const submit = screen.getByRole('button', { name: 'Добавить' })
    fireEvent.click(submit)
    fireEvent.click(submit)

    expect(screen.getByRole('button', { name: 'Сохраняем…' })).toBeDisabled()
    expect(await screen.findByRole('status')).toHaveTextContent('Новая RSS-лента')
    expect(received).toEqual({
      name: 'Новая RSS-лента',
      type: 'telegram',
      url: 'https://example.org/new-source',
      enabled: true,
    })
    expect(calls).toBe(1)
    expect(screen.getByText('6')).toBeInTheDocument()
  })

  it('keeps create values and the dialog open after 422', async () => {
    server.use(http.post('*/api/sources', () =>
      HttpResponse.json({ message: 'URL уже добавлен' }, { status: 422 }),
    ))
    renderSources()
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить источник' }))
    fillCreateForm()
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('URL уже добавлен')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Название')).toHaveValue('  Новая RSS-лента  ')
    expect(screen.getByLabelText('URL')).toHaveValue('https://example.org/new-source')
  })

  it('edits only changed name and URL while keeping type read-only', async () => {
    let received: SourcePatch | null = null
    server.use(http.patch('*/api/sources/:sourceId', async ({ request }) => {
      received = await request.json() as SourcePatch
      return HttpResponse.json({ ...sources[0], ...received })
    }))
    renderSources()
    const card = await sourceCard(sources[0].name)
    fireEvent.click(within(card).getByRole('button', { name: 'Редактировать' }))

    expect(screen.queryByLabelText('Тип')).not.toBeInTheDocument()
    expect(screen.getByText('Тип источника нельзя изменить.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: '  Обновлённый портал  ' } })
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://regulator.example/new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByRole('status')).toHaveTextContent('обновлён')
    expect(received).toEqual({
      name: 'Обновлённый портал',
      url: 'https://regulator.example/new',
    })
    expect(screen.getByRole('heading', { name: 'Обновлённый портал' })).toBeInTheDocument()
  })

  it('shows an edit 404, refreshes the list and preserves entered values', async () => {
    server.use(http.patch('*/api/sources/:sourceId', () =>
      HttpResponse.json({ message: 'не найден' }, { status: 404 }),
    ))
    renderSources()
    const card = await sourceCard(sources[0].name)
    fireEvent.click(within(card).getByRole('button', { name: 'Редактировать' }))
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Несохранённое имя' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('больше не существует')
    expect(screen.getByLabelText('Название')).toHaveValue('Несохранённое имя')
  })

  it('closes on Escape and restores focus to the opener', async () => {
    renderSources()
    const opener = await screen.findByRole('button', { name: 'Добавить источник' })
    opener.focus()
    fireEvent.click(opener)
    const close = screen.getByRole('button', { name: 'Закрыть диалог' })
    await waitFor(() => expect(close).toHaveFocus())
    const submit = screen.getByRole('button', { name: 'Добавить' })
    submit.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(opener).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('source card actions', () => {
  it('runs all live sources and shows transparent aggregate statistics', async () => {
    const liveSource = {
      ...sources[0],
      id: 'source-live-rss',
      name: 'Live RSS',
      is_demo: false,
    } satisfies Source
    const report = {
      status: 'completed',
      started_at: '2026-09-05T08:00:00Z',
      finished_at: '2026-09-05T08:00:05Z',
      sources: [{
        source_id: liveSource.id,
        status: 'success',
        collected: 12,
        created: 2,
        already_seen: 9,
        content_duplicates: 1,
        exact_duplicates: 10,
        semantic_candidates: 0,
        error: null,
      }],
      collected: 12,
      created: 2,
      already_seen: 9,
      content_duplicates: 1,
      exact_duplicates: 10,
      semantic_candidates: 0,
    } satisfies CollectionReport
    let calls = 0
    server.use(
      http.get('*/api/sources', () => HttpResponse.json([liveSource, sources[1]])),
      http.post('*/api/collections', async () => {
        calls += 1
        await delay(80)
        return HttpResponse.json(report)
      }),
    )
    renderSources()

    const collectAll = await screen.findByRole('button', { name: 'Собрать live · 1' })
    fireEvent.click(collectAll)
    fireEvent.click(collectAll)

    expect(screen.getByRole('button', { name: 'Собираем все…' })).toBeDisabled()
    const result = await screen.findByRole('status', { name: 'Результат сбора' })
    expect(result).toHaveTextContent('Общий сбор · 1 источников')
    expect(within(result).getByText('Получено от источника').parentElement).toHaveTextContent('12')
    expect(within(result).getByText('Добавлено новых').parentElement).toHaveTextContent('2')
    expect(within(result).getByText('Уже были в базе').parentElement).toHaveTextContent('9')
    expect(within(result).getByText('Совпал только текст').parentElement).toHaveTextContent('1')
    expect(calls).toBe(1)
  })

  it('toggles from active to paused and back, updates the counter, and blocks repeats', async () => {
    let enabled = true
    let calls = 0
    server.use(http.patch('*/api/sources/source-regulation', async ({ request }) => {
      calls += 1
      const patch = await request.json() as SourcePatch
      await delay(80)
      enabled = patch.enabled ?? enabled
      return HttpResponse.json({ ...sources[0], enabled })
    }))
    renderSources()
    const card = await sourceCard(sources[0].name)
    const disable = within(card).getByRole('button', { name: 'Отключить' })
    fireEvent.click(disable)
    fireEvent.click(disable)

    expect(within(card).getByRole('button', { name: 'Отключаем…' })).toBeDisabled()
    expect(screen.getByText('5')).toBeInTheDocument()
    await waitFor(() => expect(within(card).getByText('Пауза')).toBeInTheDocument())
    expect(calls).toBe(1)
    expect(screen.getByText('4')).toBeInTheDocument()

    fireEvent.click(within(card).getByRole('button', { name: 'Включить' }))
    await waitFor(() => expect(within(card).getByText('Активен')).toBeInTheDocument())
    expect(calls).toBe(2)
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('shows successful collection statistics and refreshed health fields', async () => {
    renderSources()
    const card = await sourceCard(sources[0].name)
    fireEvent.click(within(card).getByRole('button', { name: 'Запустить сбор' }))

    expect(within(card).getByRole('button', { name: 'Запускаем…' })).toBeDisabled()
    const result = await within(card).findByRole('status', { name: 'Результат сбора' })
    expect(result).toHaveTextContent('completed')
    expect(within(result).getByText('Получено от источника').parentElement).toHaveTextContent('3')
    expect(within(result).getByText('Добавлено новых').parentElement).toHaveTextContent('2')
    expect(within(result).getByText('Уже были в базе').parentElement).toHaveTextContent('1')
    expect(within(result).getByText('Совпал только текст').parentElement).toHaveTextContent('0')
    expect(within(result).getByText('Кандидаты по смыслу').parentElement).toHaveTextContent('1')
    await waitFor(() => expect(within(card).getAllByText(formatDate('2026-09-04T12:01:05Z'))).toHaveLength(2))
    expect(within(card).getByText('Ошибок нет')).toBeInTheDocument()
  })

  it('treats a failed HTTP 200 report as an alert and refreshes error state', async () => {
    renderSources()
    const card = await sourceCard('Отраслевой Telegram-архив (demo)')
    fireEvent.click(within(card).getByRole('button', { name: 'Запустить сбор' }))

    const result = await within(card).findByRole('alert', { name: 'Результат сбора' })
    expect(result).toHaveTextContent('failed')
    expect(result).toHaveTextContent('Архив временно недоступен')
    await waitFor(() => expect(within(card).getAllByText('Архив временно недоступен')).toHaveLength(2))
    expect(within(card).getByText(formatDate(sources[4].last_success_at!))).toBeInTheDocument()
    expect(within(card).getByText(formatDate('2026-09-04T12:01:05Z'))).toBeInTheDocument()
  })

  it('shows partial failure details returned with HTTP 200', async () => {
    const partialReport = {
      status: 'partial_failure',
      started_at: '2026-09-04T13:00:00Z',
      finished_at: '2026-09-04T13:00:05Z',
      sources: [{
        source_id: sources[0].id,
        status: 'partial',
        collected: 2,
        created: 1,
        already_seen: 0,
        content_duplicates: 0,
        exact_duplicates: 0,
        semantic_candidates: 1,
        error: 'Одна запись пропущена',
      }],
      collected: 2,
      created: 1,
      already_seen: 0,
      content_duplicates: 0,
      exact_duplicates: 0,
      semantic_candidates: 1,
    } satisfies CollectionReport
    server.use(http.post('*/api/sources/source-regulation/collections', () => HttpResponse.json(partialReport)))
    renderSources()
    const card = await sourceCard(sources[0].name)
    fireEvent.click(within(card).getByRole('button', { name: 'Запустить сбор' }))
    expect(await within(card).findByRole('alert')).toHaveTextContent('partial_failure')
    expect(within(card).getByText('Одна запись пропущена')).toBeInTheDocument()
  })

  it('shows 404 and network failures without replacing the page', async () => {
    server.use(http.patch('*/api/sources/source-regulation', () =>
      HttpResponse.json({ message: 'не найден' }, { status: 404 }),
    ))
    renderSources()
    const firstCard = await sourceCard(sources[0].name)
    fireEvent.click(within(firstCard).getByRole('button', { name: 'Отключить' }))
    expect(await within(firstCard).findByRole('alert')).toHaveTextContent('больше не существует')

    server.use(http.post('*/api/sources/source-duma/collections', () => HttpResponse.error()))
    const secondCard = await sourceCard(sources[1].name)
    fireEvent.click(within(secondCard).getByRole('button', { name: 'Запустить сбор' }))
    expect(await within(secondCard).findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: sources[2].name })).toBeInTheDocument()
  })
})
