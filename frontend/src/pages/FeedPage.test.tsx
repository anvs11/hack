import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { createTestRouter } from '../app/router'
import { publicationDetails } from '../mocks/fixtures'
import { api } from '../shared/api/client'
import type { PublicationList } from '../shared/api/types'
import { formatDate } from '../shared/format'
import { server } from '../test/setup'

function renderFeed(path = '/feed') {
  const router = createTestRouter(path)
  render(<RouterProvider router={router} />)
  return router
}

describe('analyst feed', () => {
  it('shows loading while the initial API requests are pending', () => {
    renderFeed()

    expect(screen.getByRole('heading', { name: 'Собираем ленту' })).toBeInTheDocument()
  })

  it('shows complete publication metadata and a separate review status', async () => {
    renderFeed()

    const title = 'В отраслевом канале обсуждают возможное изменение требований'
    const titleLink = await screen.findByRole('link', { name: title })
    const card = titleLink.closest('article')

    expect(card).not.toBeNull()
    const cardQueries = within(card!)
    expect(cardQueries.getByText('Отраслевой Telegram-архив (demo)')).toBeInTheDocument()
    expect(cardQueries.getByText(formatDate('2026-09-01T09:15:00Z'))).toBeInTheDocument()
    expect(cardQueries.getByText('Категория · Регуляторика')).toBeInTheDocument()
    expect(cardQueries.getByText('AI-приоритет · Средний')).toBeInTheDocument()
    expect(cardQueries.getByText('Требует проверки')).toBeInTheDocument()

    const originalLink = cardQueries.getByRole('link', { name: 'Открыть оригинал' })
    expect(originalLink).toHaveAttribute(
      'href',
      'https://example.org/telegram/demo-tg-005',
    )
    expect(originalLink).toHaveAttribute('target', '_blank')
    expect(originalLink).toHaveAttribute('rel', 'noreferrer')
  })

  it('sorts critical and high priorities before medium and low deterministically', async () => {
    const priorities = {
      'pub-001': 'high',
      'pub-004': 'low',
      'pub-005': 'critical',
      'pub-008': 'low',
      'pub-009': 'medium',
    } as const
    const unsortedItems = publicationDetails.map((item) => ({
      ...item,
      latest_analysis: item.latest_analysis && {
        ...item.latest_analysis,
        proposed_priority: priorities[item.publication.id as keyof typeof priorities],
      },
    }))
    server.use(
      http.get('*/api/publications', ({ request }) => {
        const limit = Number(new URL(request.url).searchParams.get('limit') ?? 20)
        return HttpResponse.json({
          items: unsortedItems,
          total: unsortedItems.length,
          limit,
          offset: 0,
        } satisfies PublicationList)
      }),
    )
    renderFeed()

    await screen.findByRole('link', {
      name: 'В отраслевом канале обсуждают возможное изменение требований',
    })
    const titles = screen.getAllByRole('article').map((card) =>
      within(card).getByRole('heading', { level: 2 }).textContent?.replace('↗', '').trim(),
    )

    expect(titles).toEqual([
      'В отраслевом канале обсуждают возможное изменение требований',
      'Проект требований к обработке данных вынесен на обсуждение',
      'Конкурент представил платформу аналитики',
      'Компания опровергла сообщение о сбое сервиса',
      'Рынок облачных сервисов показал рост',
    ])
  })

  it('restores search and all filters from the URL', async () => {
    const router = renderFeed(
      '/feed?q=%D1%80%D1%8B%D0%BD%D0%BE%D0%BA&source_id=source-media-rss-2&source_type=rss&category=trend&proposed_priority=medium&needs_review=false',
    )

    expect(await screen.findByLabelText('Поиск по ленте')).toHaveValue('рынок')
    expect(screen.getByLabelText('Источник')).toHaveValue('source-media-rss-2')
    expect(screen.getByLabelText('Тип источника')).toHaveValue('rss')
    expect(screen.getByLabelText('Категория')).toHaveValue('trend')
    expect(screen.getByLabelText('AI-приоритет')).toHaveValue('medium')
    expect(screen.getByLabelText('Статус проверки')).toHaveValue('false')
    expect(screen.getByText('Активно: 5')).toBeInTheDocument()
    expect(router.state.location.search).toContain('q=')
    expect(
      await screen.findByRole('link', { name: 'Рынок облачных сервисов показал рост' }),
    ).toBeInTheDocument()
  })

  it('debounces and trims search before updating the URL and API request', async () => {
    const seenQueries: (string | null)[] = []
    server.use(
      http.get('*/api/publications', ({ request }) => {
        const url = new URL(request.url)
        seenQueries.push(url.searchParams.get('q'))
        return HttpResponse.json({
          items: publicationDetails,
          total: publicationDetails.length,
          limit: 20,
          offset: 0,
        } satisfies PublicationList)
      }),
    )
    const router = renderFeed()
    const search = await screen.findByLabelText('Поиск по ленте')
    const requestsBeforeTyping = seenQueries.length

    fireEvent.change(search, { target: { value: '  проект  ' } })
    expect(router.state.location.search).toBe('')
    expect(seenQueries).toHaveLength(requestsBeforeTyping)

    await waitFor(() => expect(router.state.location.search).toBe('?q=%D0%BF%D1%80%D0%BE%D0%B5%D0%BA%D1%82'))
    await waitFor(() => expect(seenQueries).toContain('проект'))
  })

  it('updates combined filters and reset clears controls and URL', async () => {
    const router = renderFeed()
    await screen.findByLabelText('Источник')

    fireEvent.change(screen.getByLabelText('Тип источника'), { target: { value: 'rss' } })
    fireEvent.change(screen.getByLabelText('Категория'), { target: { value: 'trend' } })
    fireEvent.change(screen.getByLabelText('AI-приоритет'), { target: { value: 'medium' } })
    fireEvent.change(screen.getByLabelText('Статус проверки'), { target: { value: 'false' } })

    await waitFor(() => expect(screen.getByText('Активно: 4')).toBeInTheDocument())
    expect(router.state.location.search).toContain('source_type=rss')
    expect(router.state.location.search).toContain('category=trend')
    expect(router.state.location.search).toContain('proposed_priority=medium')
    expect(router.state.location.search).toContain('needs_review=false')
    expect(
      await screen.findByRole('link', { name: 'Рынок облачных сервисов показал рост' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }))

    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(screen.getByLabelText('Тип источника')).toHaveValue('')
    expect(screen.getByText('Активно: 0')).toBeInTheDocument()
  })

  it('shows no-results separately and offers to reset criteria', async () => {
    const router = renderFeed('/feed?q=%D0%BD%D0%B5%D1%81%D1%83%D1%89%D0%B5%D1%81%D1%82%D0%B2%D1%83%D1%8E%D1%89%D0%B8%D0%B9')

    expect(await screen.findByRole('heading', { name: 'Ничего не найдено' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить поиск и фильтры' }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
  })

  it('shows the empty state when the feed has no publications', async () => {
    server.use(
      http.get('*/api/publications', ({ request }) => {
        const params = new URL(request.url).searchParams
        return HttpResponse.json({
          items: [],
          total: 0,
          limit: Number(params.get('limit') ?? 20),
          offset: 0,
        } satisfies PublicationList)
      }),
    )
    renderFeed()

    expect(await screen.findByRole('heading', { name: 'Публикаций нет' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('В ленте пока нет материалов.')
    expect(screen.getByRole('status')).not.toHaveTextContent('mock')
  })

  it('shows the API error state', async () => {
    server.use(
      http.get('*/api/publications', () =>
        HttpResponse.json({ message: 'Mock API недоступен' }, { status: 500 }),
      ),
    )
    renderFeed()

    expect(await screen.findByRole('alert')).toHaveTextContent('Лента не загрузилась')
    expect(screen.getByRole('alert')).toHaveTextContent('Mock API недоступен')
  })
})

describe('publication mock handler', () => {
  it('filters by each approved parameter and combines filters', async () => {
    expect((await api.listPublications({ q: 'проект' })).items.map((item) => item.publication.id)).toEqual(['pub-001'])
    expect((await api.listPublications({ source_id: 'source-media-rss-1' })).items.map((item) => item.publication.id)).toEqual(['pub-008'])
    expect((await api.listPublications({ source_type: 'telegram_archive' })).items.map((item) => item.publication.id)).toEqual(['pub-005'])
    expect((await api.listPublications({ category: 'reputation' })).items.map((item) => item.publication.id)).toEqual(['pub-008'])
    expect((await api.listPublications({ proposed_priority: 'high' })).items.map((item) => item.publication.id)).toEqual(['pub-001'])
    expect((await api.listPublications({ needs_review: false })).items.map((item) => item.publication.id)).toEqual(['pub-009', 'pub-004'])

    const combined = await api.listPublications({
      source_id: 'source-media-rss-2',
      source_type: 'rss',
      category: 'trend',
      proposed_priority: 'medium',
      needs_review: false,
    })
    expect(combined.items.map((item) => item.publication.id)).toEqual(['pub-004'])
  })

  it('sorts before applying limit and offset', async () => {
    const firstPage = await api.listPublications({ limit: 2, offset: 0 })
    const secondPage = await api.listPublications({ limit: 2, offset: 2 })

    expect(firstPage.total).toBe(5)
    expect(firstPage.items.map((item) => item.publication.id)).toEqual(['pub-001', 'pub-009'])
    expect(secondPage.items.map((item) => item.publication.id)).toEqual(['pub-008', 'pub-005'])
  })
})
