import { render, screen } from '@testing-library/react'
import { RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { api } from '../shared/api/client'
import { createTestRouter } from './router'

describe('application routes', () => {
  it.each([
    ['/feed', 'Лента сигналов'],
    ['/publications/pub-001', 'Проект требований к обработке данных вынесен на обсуждение'],
    ['/regulatory-cases/case-001', 'Демонстрационные требования к обработке данных'],
    ['/sources', 'Источники'],
    ['/digest', 'Дайджест для руководителя'],
  ])('opens %s', async (path, heading) => {
    render(<RouterProvider router={createTestRouter(path)} />)

    expect(
      await screen.findByRole('heading', { name: heading, level: 1 }),
    ).toBeInTheDocument()
  })

  it('shows the 404 page for an unknown route', async () => {
    render(<RouterProvider router={createTestRouter('/missing-page')} />)

    expect(
      await screen.findByRole('heading', { name: 'Страница не найдена' }),
    ).toBeInTheDocument()
  })
})

describe('mock API', () => {
  it('returns a typed publication list and renders its data', async () => {
    const response = await api.listPublications()
    expect(response.total).toBeGreaterThan(0)
    expect(response.items[0]?.publication.id).toBe('pub-001')

    render(<RouterProvider router={createTestRouter('/feed')} />)
    expect(
      await screen.findByRole('link', {
        name: 'Проект требований к обработке данных вынесен на обсуждение',
      }),
    ).toBeInTheDocument()
  })
})
