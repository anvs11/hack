import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestRouter } from '../app/router'
import {
  analysis001v2,
  existingDecision,
  publicationDetails,
  publicationHistory,
  regulatoryCaseDetail,
} from '../mocks/fixtures'
import type {
  PublicationDetail,
  PublicationList,
  SpecialistDecision,
} from '../shared/api/types'
import { formatDate } from '../shared/format'
import { server } from '../test/setup'

function renderDigest() {
  render(<RouterProvider router={createTestRouter('/digest')} />)
}

function publicationResponse(items: readonly PublicationDetail[] = publicationDetails): PublicationList {
  return {
    items: [...items],
    total: items.length,
    limit: 100,
    offset: 0,
  }
}

function currentCriticalDecision(): SpecialistDecision {
  return {
    ...existingDecision,
    id: 'decision-current-critical',
    analysis_id: analysis001v2.id,
    version: 2,
    status: 'confirmed',
    final_summary: 'Критический материал подтверждён специалистом.',
    final_priority: 'critical',
    created_at: '2026-09-04T09:30:00Z',
  }
}

function useFullDigestHandlers() {
  const currentDecision = currentCriticalDecision()
  const items: PublicationDetail[] = publicationDetails.map((detail) => detail.publication.id === 'pub-001'
    ? { ...detail, latest_decision: currentDecision }
    : detail)
  server.use(
    http.get('*/api/publications', () => HttpResponse.json(publicationResponse(items))),
    http.get('*/api/publications/pub-001/history', () => HttpResponse.json({
      ...publicationHistory,
      decisions: [...publicationHistory.decisions, currentDecision],
    })),
  )
}

function readBlob(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(reader.error))
    reader.readAsText(blob)
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DigestPage', () => {
  it('shows a loading state and disables both exports during loading', () => {
    server.use(
      http.get('*/api/publications', async () => {
        await delay(150)
        return HttpResponse.json(publicationResponse())
      }),
    )

    renderDigest()

    expect(screen.getByRole('heading', { name: 'Формируем дайджест' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Скачать JSON' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Скачать Markdown' })).toBeDisabled()
  })

  it('renders all four populated sections and correct summary counters', async () => {
    useFullDigestHandlers()
    renderDigest()

    expect(await screen.findByRole('heading', { name: 'Подтверждённые критические материалы' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Изменения стадий НПА' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Требующие проверки карточки' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Действия пользователей' })).toBeInTheDocument()

    const counters = screen.getByRole('group', { name: 'Сводные счётчики' })
    expect(within(counters).getByText('Критические').nextElementSibling).toHaveTextContent('1')
    expect(within(counters).getByText('Стадии НПА').nextElementSibling).toHaveTextContent('1')
    expect(within(counters).getByText('На проверке').nextElementSibling).toHaveTextContent('2')
    expect(within(counters).getByText('Действия').nextElementSibling).toHaveTextContent('3')
    expect(screen.getByText('Критический материал подтверждён специалистом.')).toBeInTheDocument()
    expect(screen.getByText('Зафиксирована начальная стадия — Проект')).toBeInTheDocument()
  })

  it('renders an individual empty state for every empty section and one overall empty state', async () => {
    server.use(
      http.get('*/api/publications', () => HttpResponse.json(publicationResponse([]))),
      http.get('*/api/regulatory-cases', () => HttpResponse.json([])),
      http.get('*/api/sources', () => HttpResponse.json([])),
    )
    renderDigest()

    expect(await screen.findByRole('heading', { name: 'Дайджест пуст' })).toBeInTheDocument()
    expect(screen.getByText('Нет подтверждённых актуальных решений с критическим приоритетом.')).toBeInTheDocument()
    expect(screen.getByText('Нет официально подтверждённых событий в timeline кейсов НПА.')).toBeInTheDocument()
    expect(screen.getByText('Нет новых версий AI-анализа, ожидающих решения специалиста.')).toBeInTheDocument()
    expect(screen.getByText('Нет сохранённых решений специалистов и lifecycle events.')).toBeInTheDocument()
  })

  it('shows a fatal load error, disables export, and retries successfully', async () => {
    let requests = 0
    server.use(
      http.get('*/api/publications', () => {
        requests += 1
        return requests === 1
          ? HttpResponse.json({ message: 'Временная ошибка API' }, { status: 500 })
          : HttpResponse.json(publicationResponse())
      }),
    )
    renderDigest()

    expect(await screen.findByRole('alert')).toHaveTextContent('Временная ошибка API')
    expect(screen.getByRole('button', { name: 'Скачать JSON' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Скачать Markdown' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))

    expect(await screen.findByText('all_available_data')).toBeInTheDocument()
    expect(requests).toBe(2)
    expect(screen.getByRole('button', { name: 'Скачать JSON' })).toBeEnabled()
  })

  it('performs a fresh request after manual refresh', async () => {
    let requests = 0
    server.use(
      http.get('*/api/publications', () => {
        requests += 1
        return HttpResponse.json(publicationResponse())
      }),
    )
    renderDigest()
    await screen.findByText('all_available_data')
    expect(requests).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }))

    expect(screen.getByRole('button', { name: 'Обновляем…' })).toBeDisabled()
    await waitFor(() => expect(requests).toBe(2))
    expect(await screen.findByRole('button', { name: 'Обновить' })).toBeEnabled()
  })

  it('renders working internal and external links', async () => {
    renderDigest()

    const reviewTitle = await screen.findByRole('link', {
      name: 'В отраслевом канале обсуждают возможное изменение требований',
    })
    expect(reviewTitle).toHaveAttribute('href', '/publications/pub-005')
    const original = screen.getAllByRole('link', { name: 'Открыть оригинал ↗' })[0]
    expect(original).toHaveAttribute('target', '_blank')
    expect(original).toHaveAttribute('rel', 'noreferrer')

    const caseLink = screen.getAllByRole('link', {
      name: 'Демонстрационные требования к обработке данных',
    })[0]
    expect(caseLink).toHaveAttribute('href', '/regulatory-cases/case-001')
    expect(screen.getAllByRole('link', { name: /Официальн(ое подтверждение|ый источник) ↗/ })[0])
      .toHaveAttribute('href', regulatoryCaseDetail.timeline[0].confirmation_url)
  })

  it('downloads matching JSON and Markdown snapshots with correct MIME, names, and revocation', async () => {
    useFullDigestHandlers()
    const blobs: Blob[] = []
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob)
      return `blob:digest-${blobs.length}`
    })
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const downloads: string[] = []
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      const element = originalCreateElement(tagName)
      if (tagName.toLowerCase() === 'a') {
        Object.defineProperty(element, 'download', {
          configurable: true,
          set: (value: string) => downloads.push(value),
          get: () => downloads.at(-1) ?? '',
        })
      }
      return element
    }) as typeof document.createElement)
    renderDigest()
    await screen.findByText('all_available_data')

    fireEvent.click(screen.getByRole('button', { name: 'Скачать JSON' }))
    fireEvent.click(screen.getByRole('button', { name: 'Скачать Markdown' }))

    expect(blobs).toHaveLength(2)
    expect(blobs[0].type).toBe('application/json;charset=utf-8')
    expect(blobs[1].type).toBe('text/markdown;charset=utf-8')
    expect(downloads[0]).toMatch(/^digest-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.json$/)
    expect(downloads[1]).toBe(downloads[0].replace(/\.json$/, '.md'))
    expect(createObjectURL).toHaveBeenCalledTimes(2)
    expect(click).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL).toHaveBeenNthCalledWith(1, 'blob:digest-1')
    expect(revokeObjectURL).toHaveBeenNthCalledWith(2, 'blob:digest-2')

    const json = await readBlob(blobs[0])
    const markdown = await readBlob(blobs[1])
    const parsed = JSON.parse(json) as {
      generated_at: string
      summary: { critical_materials: number; user_actions: number }
    }
    expect(parsed.summary).toMatchObject({ critical_materials: 1, user_actions: 3 })
    expect(screen.getByText(formatDate(parsed.generated_at))).toBeInTheDocument()
    expect(markdown).toContain('## Подтверждённые критические материалы')
    expect(markdown).toContain('Критический материал подтверждён специалистом')
    expect(json).toContain(parsed.generated_at)
    expect(markdown).toContain('Дата формирования:')
  })

  it('never requests a digest endpoint', async () => {
    let digestRequests = 0
    server.use(
      http.all('*/api/digest', () => {
        digestRequests += 1
        return HttpResponse.json({ unexpected: true })
      }),
    )
    renderDigest()

    await screen.findByText('all_available_data')
    expect(digestRequests).toBe(0)
  })
})
