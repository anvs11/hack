import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { createTestRouter } from '../app/router'
import {
  regulatoryCaseDetail,
} from '../mocks/fixtures'
import type {
  LifecycleEvent,
  LifecycleEventCreate,
  LifecycleStage,
  RegulatoryCaseDetail,
} from '../shared/api/types'
import { formatDate } from '../shared/format'
import { server } from '../test/setup'

function renderCase() {
  render(<RouterProvider router={createTestRouter('/regulatory-cases/case-001')} />)
}

function useCaseDetail(detail: RegulatoryCaseDetail) {
  server.use(
    http.get('*/api/regulatory-cases/case-001', () => HttpResponse.json(detail)),
  )
}

function fillRequiredEventFields() {
  fireEvent.change(screen.getByLabelText('Дата события'), {
    target: { value: '2026-09-04T12:00' },
  })
  fireEvent.change(screen.getByLabelText('Ссылка на официальное подтверждение'), {
    target: { value: 'https://regulator.example/events/introduced' },
  })
}

const stageCases: [LifecycleStage, string][] = [
  ['draft', 'Проект'],
  ['introduced', 'Внесён'],
  ['adopted', 'Принят'],
  ['published', 'Опубликован'],
  ['effective', 'Вступил в силу'],
  ['amended', 'Изменён'],
  ['repealed', 'Отменён'],
]

describe('regulatory case lifecycle display', () => {
  it.each(stageCases)('renders the Russian label for %s', async (stage, label) => {
    useCaseDetail({
      ...regulatoryCaseDetail,
      regulatory_case: { ...regulatoryCaseDetail.regulatory_case, current_stage: stage },
    })

    renderCase()

    expect(await screen.findByText(label, { selector: '.stage-card strong' })).toBeInTheDocument()
  })

  it('uses regulatory_case.current_stage instead of deriving it from the timeline', async () => {
    useCaseDetail({
      ...regulatoryCaseDetail,
      regulatory_case: { ...regulatoryCaseDetail.regulatory_case, current_stage: 'adopted' },
      timeline: [{ ...regulatoryCaseDetail.timeline[0], stage: 'draft' }],
    })

    renderCase()

    expect(await screen.findByText('Принят', { selector: '.stage-card strong' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Проект' })).toBeInTheDocument()
  })

  it('shows occurred dates, official source labels, URLs, comments and authors in server order', async () => {
    const secondEvent = {
      ...regulatoryCaseDetail.timeline[0],
      id: 'event-002',
      stage: 'introduced',
      occurred_at: '2026-09-02T10:00:00Z',
      confirmation_url: 'https://publication.example/official/2',
      confirmation_source_type: 'official_publication',
      comment: null,
      author_id: 'user-gr-002',
    } satisfies LifecycleEvent
    useCaseDetail({
      ...regulatoryCaseDetail,
      regulatory_case: { ...regulatoryCaseDetail.regulatory_case, current_stage: 'introduced' },
      timeline: [regulatoryCaseDetail.timeline[0], secondEvent],
    })

    renderCase()

    const timeline = await screen.findByRole('list', { name: 'Хронология' })
    const cards = within(timeline).getAllByRole('listitem')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveTextContent(formatDate('2026-09-01T07:30:00Z'))
    expect(cards[0]).toHaveTextContent('Официальный сайт регулятора')
    expect(cards[0]).toHaveTextContent('Проект опубликован для общественного обсуждения.')
    expect(cards[0]).toHaveTextContent('user-gr-001')
    expect(cards[1]).toHaveTextContent(formatDate('2026-09-02T10:00:00Z'))
    expect(cards[1]).toHaveTextContent('Официальное опубликование')
    expect(cards[1]).toHaveTextContent('Комментарий отсутствует')
    expect(cards[1]).toHaveTextContent('user-gr-002')
    expect(within(cards[1]).getByRole('link', { name: /Официальное подтверждение/ })).toHaveAttribute(
      'href',
      'https://publication.example/official/2',
    )
  })

  it('shows explicit empty states for timeline and related publications', async () => {
    useCaseDetail({
      regulatory_case: {
        ...regulatoryCaseDetail.regulatory_case,
        related_publication_ids: [],
      },
      timeline: [],
    })

    renderCase()

    expect(await screen.findByRole('heading', { name: 'Событий пока нет' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Связанных публикаций нет' })).toBeInTheDocument()
  })

  it('renders related IDs as links and marks Telegram as supplementary evidence', async () => {
    renderCase()

    const officialLink = await screen.findByRole('link', {
      name: 'Проект требований к обработке данных вынесен на обсуждение',
    })
    const telegramLink = screen.getByRole('link', {
      name: 'В отраслевом канале обсуждают возможное изменение требований',
    })
    expect(officialLink).toHaveAttribute('href', '/publications/pub-001')
    expect(telegramLink).toHaveAttribute('href', '/publications/pub-005')
    expect(screen.getByText('pub-001')).toBeInTheDocument()
    expect(screen.getByText('pub-005')).toBeInTheDocument()
    expect(screen.getByText('Дополнительный материал · Telegram archive')).toBeInTheDocument()
    expect(screen.getByText(/Они не изменяют стадию/)).toBeInTheDocument()
    expect(screen.getByText(/СМИ и Telegram являются только дополнительными материалами/)).toBeInTheDocument()
  })

  it('keeps a working publication-ID fallback when one metadata request fails', async () => {
    server.use(
      http.get('*/api/publications/pub-005', () =>
        HttpResponse.json({ message: 'metadata unavailable' }, { status: 500 }),
      ),
    )

    renderCase()

    expect(await screen.findByRole('link', { name: 'Публикация pub-005' })).toHaveAttribute(
      'href',
      '/publications/pub-005',
    )
    expect(screen.getByText('Демонстрационные требования к обработке данных')).toBeInTheDocument()
  })
})

describe('official lifecycle event form', () => {
  it('allows the current stage as the first event and offers only official source types', async () => {
    useCaseDetail({ ...regulatoryCaseDetail, timeline: [] })
    renderCase()

    const stage = await screen.findByLabelText('Стадия')
    expect(within(stage).getByRole('option', { name: 'Проект' })).toHaveValue('draft')
    expect(within(stage).getByRole('option', { name: 'Внесён' })).toHaveValue('introduced')
    const source = screen.getByLabelText('Тип официального источника')
    expect(within(source).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Официальный сайт регулятора',
      'Официальное опубликование',
    ])
    expect(within(source).queryByText(/media|telegram|rss|seed/i)).not.toBeInTheDocument()
  })

  it('creates an allowed transition, refetches detail and clears only comment and URL', async () => {
    renderCase()
    await screen.findByLabelText('Дата события')
    fillRequiredEventFields()
    fireEvent.change(screen.getByLabelText('Комментарий · необязательно'), {
      target: { value: 'Внесено в установленном порядке' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Добавить событие' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Стадия и хронология обновлены с сервера')
    expect(screen.getByText('Внесён', { selector: '.stage-card strong' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Внесён' })).toBeInTheDocument()
    expect(screen.getByText('Внесено в установленном порядке')).toBeInTheDocument()
    expect(screen.getByLabelText('Ссылка на официальное подтверждение')).toHaveValue('')
    expect(screen.getByLabelText('Комментарий · необязательно')).toHaveValue('')
    expect(screen.getByLabelText('Автор события')).toHaveValue('user-gr-001')
  })

  it('shows 409 without adding an event visually', async () => {
    renderCase()
    await screen.findByLabelText('Дата события')
    fillRequiredEventFields()
    fireEvent.change(screen.getByLabelText('Стадия'), { target: { value: 'published' } })

    fireEvent.click(screen.getByRole('button', { name: 'Добавить событие' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Переход недопустим. Данные не изменены')
    expect(within(screen.getByRole('list', { name: 'Хронология' })).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: 'Внесён' })).not.toBeInTheDocument()
  })

  it('does not show an active form after a recorded repealed stage', async () => {
    useCaseDetail({
      ...regulatoryCaseDetail,
      regulatory_case: { ...regulatoryCaseDetail.regulatory_case, current_stage: 'repealed' },
      timeline: [{ ...regulatoryCaseDetail.timeline[0], stage: 'repealed' }],
    })

    renderCase()

    const terminalMessage = await screen.findByText(/Стадия «Отменён» является терминальной/)
    expect(terminalMessage).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('button', { name: 'Добавить событие' })).not.toBeInTheDocument()
  })

  it('preserves entered values after a 422 response', async () => {
    server.use(
      http.post('*/api/regulatory-cases/case-001/lifecycle-events', () =>
        HttpResponse.json({ code: 'validation_error', message: 'invalid' }, { status: 422 }),
      ),
    )
    renderCase()
    await screen.findByLabelText('Дата события')
    fillRequiredEventFields()
    fireEvent.change(screen.getByLabelText('Комментарий · необязательно'), {
      target: { value: 'Сохранить этот комментарий' },
    })
    fireEvent.change(screen.getByLabelText('Автор события'), {
      target: { value: 'user-custom' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Добавить событие' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Введённые данные сохранены')
    expect(screen.getByLabelText('Ссылка на официальное подтверждение')).toHaveValue(
      'https://regulator.example/events/introduced',
    )
    expect(screen.getByLabelText('Комментарий · необязательно')).toHaveValue('Сохранить этот комментарий')
    expect(screen.getByLabelText('Автор события')).toHaveValue('user-custom')
  })

  it('blocks repeated clicks while the first lifecycle request is pending', async () => {
    let calls = 0
    server.use(
      http.post('*/api/regulatory-cases/case-001/lifecycle-events', async ({ request }) => {
        calls += 1
        const body = await request.json() as LifecycleEventCreate
        await delay(120)
        return HttpResponse.json({
          ...body,
          comment: body.comment ?? null,
          id: 'event-pending-test',
          regulatory_case_id: 'case-001',
          created_at: '2026-09-04T12:01:00Z',
        } satisfies LifecycleEvent, { status: 201 })
      }),
    )
    renderCase()
    await screen.findByLabelText('Дата события')
    fillRequiredEventFields()
    const form = screen.getByRole('button', { name: 'Добавить событие' }).closest('form')!

    fireEvent.submit(form)
    fireEvent.submit(form)

    expect(screen.getByRole('button', { name: 'Добавляем…' })).toBeDisabled()
    await waitFor(() => expect(calls).toBe(1))
  })
})
