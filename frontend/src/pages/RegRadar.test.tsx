import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { http, HttpResponse, delay } from 'msw'
import { RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { createTestRouter } from '../app/router'
import { publicationDetails } from '../mocks/fixtures'
import { server } from '../test/setup'
function feed(path = '/feed') {
  const router = createTestRouter(path)
  render(<RouterProvider router={router} />)
  return router
}
describe('RegRadar workflow', () => {
  it('restores position when navigation happens before the browser emits a scroll event', async () => {
    const originalScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY')!
    const scrollTo = vi.mocked(window.scrollTo)
    scrollTo.mockClear()
    try {
      feed('/feed?visibility=all&limit=2')
      const title = await screen.findByRole('link', {
        name: publicationDetails[0].publication.title,
      })
      await waitFor(() => expect(scrollTo).toHaveBeenCalled())
      Object.defineProperty(window, 'scrollY', { configurable: true, value: 812 })
      // Deliberately do not dispatch scroll: clicking may precede that event.
      fireEvent.click(title)
      const back = await screen.findByRole('link', { name: 'Вернуться к результатам' })
      scrollTo.mockClear()
      fireEvent.click(back)
      await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 812, behavior: 'instant' }))
    } finally {
      Object.defineProperty(window, 'scrollY', originalScrollY)
    }
  })
  it('shows loaded news when sources fail', async () => {
    server.use(
      http.get('*/api/sources', () =>
        HttpResponse.json({ message: 'offline' }, { status: 500 }),
      ),
    )
    feed()
    expect(
      await screen.findByRole('link', {
        name: publicationDetails[0].publication.title,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Названия источников недоступны/),
    ).toBeInTheDocument()
  })
  it('restores pagination on Back and resets offset on filter changes', async () => {
    const router = feed('/feed?limit=2&offset=2')
    await screen.findByRole('link', {
      name: publicationDetails.find((d) => d.publication.id === 'pub-008')!
        .publication.title,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Далее →' }))
    await waitFor(() =>
      expect(router.state.location.search).toContain('offset=4'),
    )
    await act(() => router.navigate(-1))
    await waitFor(() =>
      expect(router.state.location.search).toContain('offset=2'),
    )
    fireEvent.change(screen.getByLabelText('Категория'), {
      target: { value: 'regulation' },
    })
    await waitFor(() =>
      expect(router.state.location.search).not.toContain('offset='),
    )
  })
  it('ignores a late response after the query changed, even if transport ignores abort', async () => {
    server.use(
      http.get('*/api/publications', async ({ request }) => {
        const q = new URL(request.url).searchParams.get('q')
        await delay(q === 'old' ? 150 : 5)
        return HttpResponse.json({
          items: [q === 'old' ? publicationDetails[0] : publicationDetails[1]],
          total: 1,
          limit: 10,
          offset: 0,
        })
      }),
    )
    const router = feed('/feed?q=old')
    await act(() => router.navigate('/feed?q=new'))
    await screen.findByRole('link', {
      name: publicationDetails[1].publication.title,
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 180))
    })
    expect(
      screen.queryByRole('link', {
        name: publicationDetails[0].publication.title,
      }),
    ).not.toBeInTheDocument()
  })
  it('keeps a report across routes and does not let automatic summary populate it', async () => {
    const router = feed()
    const title = await screen.findByRole('link', {
      name: publicationDetails[0].publication.title,
    })
    fireEvent.click(
      within(title.closest('article')!).getByRole('button', {
        name: 'В отчёт',
      }),
    )
    await act(() => router.navigate('/digest'))
    expect(
      await screen.findByRole('heading', { name: 'Отчёт для руководителя' }),
    ).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Комментарий для менеджера'), {
      target: { value: 'Контекст для встречи' },
    })
    await act(() => router.navigate('/digest?tab=auto'))
    await screen.findByText('all_available_data')
    await act(() => router.navigate('/digest'))
    expect(screen.getByLabelText('Комментарий для менеджера')).toHaveValue(
      'Контекст для встречи',
    )
    expect(screen.getAllByRole('article')).toHaveLength(1)
  })
})
