import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, delay } from 'msw'
import { RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { createTestRouter } from '../app/router'
import {
  publicationDetails,
  regulatoryCase,
} from '../mocks/fixtures'
import type {
  PublicationDetail,
  PublicationHistory,
  SpecialistDecision,
  SpecialistDecisionCreate,
} from '../shared/api/types'
import { server } from '../test/setup'

function renderPublication() {
  render(<RouterProvider router={createTestRouter('/publications/pub-001')} />)
}

function createdDecision(
  body: SpecialistDecisionCreate,
  version = 2,
): SpecialistDecision {
  return {
    ...body,
    final_summary: body.final_summary ?? null,
    comment: body.comment ?? null,
    id: `decision-test-${version}`,
    publication_id: 'pub-001',
    version,
    created_at: '2026-09-04T10:00:00Z',
  }
}

describe('publication analysis card', () => {
  it('renders the complete selected analysis including explicit zero and false values', async () => {
    renderPublication()

    expect(await screen.findByRole('heading', { name: 'Выбранная версия' })).toBeInTheDocument()
    expect(screen.getByText('demo-replay-v2')).toBeInTheDocument()
    expect(screen.getByText('analysis-v2')).toBeInTheDocument()
    expect(screen.getByText('Опубликован проект требований')).toBeInTheDocument()
    expect(screen.getByText('обработка данных')).toBeInTheDocument()
    expect(screen.getAllByText('установил срок общественного обсуждения', { exact: false })).toHaveLength(2)
    expect(screen.getByText('12%')).toBeInTheDocument()
    expect(screen.getByText('AI-приоритет · Высокий')).toBeInTheDocument()

    const k6 = screen.getByText('K6').closest('div')
    expect(k6).not.toBeNull()
    expect(within(k6!).getByText('0')).toBeInTheDocument()
    const h1 = screen.getByText('H1').closest('div')
    expect(h1).not.toBeNull()
    expect(within(h1!).getByText('Нет · false')).toBeInTheDocument()
  })

  it('shows the honest empty state and disables specialist decisions without analysis', async () => {
    const detail = {
      ...publicationDetails[0],
      publication: { ...publicationDetails[0].publication, latest_analysis_id: null },
      latest_analysis: null,
      latest_decision: null,
    } satisfies PublicationDetail
    const history = {
      publication_id: 'pub-001',
      analyses: [],
      decisions: [],
    } satisfies PublicationHistory
    server.use(
      http.get('*/api/publications/pub-001', () => HttpResponse.json(detail)),
      http.get('*/api/publications/pub-001/history', () => HttpResponse.json(history)),
    )

    renderPublication()

    expect(await screen.findByRole('heading', { name: 'AI-анализа нет' })).toBeInTheDocument()
    expect(screen.getByText('Сохранить решение нельзя: сначала нужна версия AI-анализа.')).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('button', { name: 'Сохранить решение' })).not.toBeInTheDocument()
  })

  it('shows multiple versions and lets the user inspect an old immutable version', async () => {
    renderPublication()

    const oldVersion = await screen.findByRole('button', { name: /v1/ })
    expect(screen.getByRole('button', { name: /v2/ })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(oldVersion)

    expect(oldVersion).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('24%')).toBeInTheDocument()
    expect(screen.getByText('demo-replay-v1')).toBeInTheDocument()
    expect(screen.getByText('analysis-001 · v1')).toBeInTheDocument()
  })

  it('renders the latest specialist decision separately from the AI suggestion', async () => {
    renderPublication()

    expect(await screen.findByRole('heading', { name: 'Скорректировано' })).toBeInTheDocument()
    expect(screen.getByText('Финальное решение специалиста · v1')).toBeInTheDocument()
    expect(screen.getByText('Проверено по первоисточнику.')).toBeInTheDocument()
    expect(screen.getAllByText('Финальный приоритет').length).toBeGreaterThan(0)
  })
})

describe('specialist decision form', () => {
  it('sends a confirmed payload with null corrections and optional comment', async () => {
    let received: SpecialistDecisionCreate | null = null
    server.use(
      http.post('*/api/publications/pub-001/decisions', async ({ request }) => {
        received = await request.json() as SpecialistDecisionCreate
        return HttpResponse.json(createdDecision(received), { status: 201 })
      }),
    )
    renderPublication()
    await screen.findByLabelText('Итоговое саммари')

    fireEvent.change(screen.getByLabelText('Комментарий · необязательно'), { target: { value: '  Проверено  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить решение' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Решение специалиста сохранено')
    expect(received).toEqual({
      analysis_id: 'analysis-001-v2',
      status: 'confirmed',
      final_summary: null,
      final_category: 'regulation',
      final_priority: 'high',
      comment: 'Проверено',
      author_id: 'user-gr-001',
    })
  })

  it('sends corrected summary, category and priority against the selected analysis', async () => {
    let received: SpecialistDecisionCreate | null = null
    server.use(
      http.post('*/api/publications/pub-001/decisions', async ({ request }) => {
        received = await request.json() as SpecialistDecisionCreate
        return HttpResponse.json(createdDecision(received), { status: 201 })
      }),
    )
    renderPublication()
    await screen.findByLabelText('Итоговое саммари')

    fireEvent.change(screen.getByLabelText('Итоговое саммари'), { target: { value: 'Исправленное резюме' } })
    fireEvent.change(screen.getByLabelText('Итоговая категория'), { target: { value: 'trend' } })
    fireEvent.change(screen.getByLabelText('Финальный приоритет'), { target: { value: 'low' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить решение' }))

    await waitFor(() => expect(received).not.toBeNull())
    expect(received).toMatchObject({
      analysis_id: 'analysis-001-v2',
      status: 'corrected',
      final_summary: 'Исправленное резюме',
      final_category: 'trend',
      final_priority: 'low',
      comment: null,
    })
  })

  it('requires explicit confirmation before saving unknown final priority', async () => {
    renderPublication()
    await screen.findByLabelText('Финальный приоритет')

    fireEvent.change(screen.getByLabelText('Финальный приоритет'), { target: { value: 'unknown' } })
    const submit = screen.getByRole('button', { name: 'Сохранить решение' })
    expect(submit).toBeDisabled()

    fireEvent.click(screen.getByLabelText(/ явно подтверждаю/))
    expect(submit).toBeEnabled()
  })

  it('disables submission and prevents a double POST', async () => {
    let calls = 0
    server.use(
      http.post('*/api/publications/pub-001/decisions', async ({ request }) => {
        calls += 1
        const body = await request.json() as SpecialistDecisionCreate
        await delay(120)
        return HttpResponse.json(createdDecision(body), { status: 201 })
      }),
    )
    renderPublication()
    const submit = await screen.findByRole('button', { name: 'Сохранить решение' })

    fireEvent.click(submit)
    fireEvent.click(submit)

    expect(screen.getByRole('button', { name: 'Сохраняем…' })).toBeDisabled()
    await waitFor(() => expect(calls).toBe(1))
  })

  it('shows a controlled API error and preserves all entered values', async () => {
    server.use(
      http.post('*/api/publications/pub-001/decisions', () =>
        HttpResponse.json({ message: 'Сервер отклонил решение' }, { status: 422 }),
      ),
    )
    renderPublication()
    const summary = await screen.findByLabelText('Итоговое саммари')
    fireEvent.change(summary, { target: { value: 'Моя несохранённая правка' } })

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить решение' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Сервер отклонил решение')
    expect(summary).toHaveValue('Моя несохранённая правка')
  })
})

describe('regulatory case linking dialog', () => {
  it('lists cases and supports a successful repeated idempotent link', async () => {
    let puts = 0
    let linked = false
    server.use(
      http.get('*/api/regulatory-cases', () => HttpResponse.json([{
        ...regulatoryCase,
        related_publication_ids: linked ? ['pub-001'] : [],
      }])),
      http.put('*/api/regulatory-cases/case-001/publications/pub-001', () => {
        puts += 1
        linked = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderPublication()
    fireEvent.click(await screen.findByRole('button', { name: 'Привязать к НПА' }))

    expect(await screen.findByRole('dialog', { name: 'Привязать публикацию к НПА' })).toBeInTheDocument()
    expect(screen.getByText(regulatoryCase.title)).toBeInTheDocument()
    expect(screen.getByText(/DEMO-2026-001 · draft/)).toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: 'Подтвердить привязку' })

    fireEvent.click(confirm)
    expect(await screen.findByRole('status')).toHaveTextContent('успешно привязана')
    expect(screen.getByText('Уже привязана')).toBeInTheDocument()
    fireEvent.click(confirm)
    await waitFor(() => expect(puts).toBe(2))
    expect(screen.getAllByText('Уже привязана')).toHaveLength(1)
  })

  it('shows empty and controlled error states from the cases API', async () => {
    server.use(http.get('*/api/regulatory-cases', () => HttpResponse.json([])))
    renderPublication()
    fireEvent.click(await screen.findByRole('button', { name: 'Привязать к НПА' }))
    expect(await screen.findByText('Существующих кейсов НПА пока нет.')).toHaveAttribute('role', 'status')
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть диалог' }))

    server.use(http.get('*/api/regulatory-cases', () => HttpResponse.json({ message: 'Кейсы недоступны' }, { status: 500 })))
    fireEvent.click(screen.getByRole('button', { name: 'Привязать к НПА' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Кейсы недоступны')
  })

  it('traps focus in the named dialog and restores it after Escape', async () => {
    renderPublication()
    const opener = await screen.findByRole('button', { name: 'Привязать к НПА' })
    opener.focus()
    fireEvent.click(opener)

    const close = screen.getByRole('button', { name: 'Закрыть диалог' })
    await waitFor(() => expect(close).toHaveFocus())
    await screen.findByRole('radio', { name: /DEMO-2026-001/ })
    const confirm = screen.getByRole('button', { name: 'Подтвердить привязку' })

    confirm.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(confirm).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(opener).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps keyboard controls labelled and reachable', async () => {
    renderPublication()
    const summary = await screen.findByLabelText('Итоговое саммари')
    const category = screen.getByLabelText('Итоговая категория')
    const priority = screen.getByLabelText('Финальный приоритет')

    ;[summary, category, priority].forEach((control) => {
      control.focus()
      expect(control).toHaveFocus()
    })
  })
})

describe('controlled publication API failure', () => {
  it('renders a visible page-level alert', async () => {
    server.use(
      http.get('*/api/publications/pub-001/history', () =>
        HttpResponse.json({ message: 'История недоступна' }, { status: 500 }),
      ),
    )
    renderPublication()
    expect(await screen.findByRole('alert')).toHaveTextContent('История недоступна')
  })
})
