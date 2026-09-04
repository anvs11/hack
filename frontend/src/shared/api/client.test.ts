import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../test/setup'
import { api } from './client'
import { publicationHistory, regulatoryCases } from '../../mocks/fixtures'
import type {
  PublicationList,
  SpecialistDecision,
  SpecialistDecisionCreate,
} from './types'

const emptyList = {
  items: [],
  total: 0,
  limit: 20,
  offset: 0,
} satisfies PublicationList

describe('publication API client', () => {
  it('encodes every defined list filter and omits undefined values', async () => {
    let receivedParams = new URLSearchParams()
    server.use(
      http.get('*/api/publications', ({ request }) => {
        receivedParams = new URL(request.url).searchParams
        return HttpResponse.json(emptyList)
      }),
    )

    await api.listPublications({
      q: 'проект & данные',
      source_id: 'source-regulation',
      source_type: 'regulator',
      category: 'regulation',
      proposed_priority: 'high',
      needs_review: true,
      limit: 12,
      offset: 4,
      published_from: undefined,
    })

    expect(Object.fromEntries(receivedParams)).toEqual({
      q: 'проект & данные',
      source_id: 'source-regulation',
      source_type: 'regulator',
      category: 'regulation',
      proposed_priority: 'high',
      needs_review: 'true',
      limit: '12',
      offset: '4',
    })
  })

  it('reads publication history through the contract path', async () => {
    let requestedUrl = ''
    server.use(
      http.get('*/api/publications/pub-001/history', ({ request }) => {
        requestedUrl = request.url
        return HttpResponse.json(publicationHistory)
      }),
    )

    const history = await api.getPublicationHistory('pub-001')

    expect(new URL(requestedUrl).pathname).toBe('/api/publications/pub-001/history')
    expect(history.analyses).toHaveLength(2)
  })

  it('creates a typed specialist decision with JSON body', async () => {
    let received: SpecialistDecisionCreate | null = null
    const payload = {
      analysis_id: 'analysis-001-v2',
      status: 'confirmed',
      final_summary: null,
      final_category: 'regulation',
      final_priority: 'high',
      comment: null,
      author_id: 'user-gr-001',
    } satisfies SpecialistDecisionCreate
    server.use(
      http.post('*/api/publications/pub-001/decisions', async ({ request }) => {
        received = await request.json() as SpecialistDecisionCreate
        return HttpResponse.json({
          ...payload,
          id: 'decision-client-test',
          publication_id: 'pub-001',
          version: 2,
          created_at: '2026-09-04T10:00:00Z',
        } satisfies SpecialistDecision, { status: 201 })
      }),
    )

    const decision = await api.createSpecialistDecision('pub-001', payload)

    expect(received).toEqual(payload)
    expect(decision.version).toBe(2)
  })

  it('lists regulatory cases and handles the 204 link response', async () => {
    let linked = false
    server.use(
      http.get('*/api/regulatory-cases', () => HttpResponse.json(regulatoryCases)),
      http.put('*/api/regulatory-cases/case-001/publications/pub-001', () => {
        linked = true
        return new HttpResponse(null, { status: 204 })
      }),
    )

    expect(await api.listRegulatoryCases()).toEqual(regulatoryCases)
    await expect(api.linkPublicationToCase('case-001', 'pub-001')).resolves.toBeUndefined()
    expect(linked).toBe(true)
  })
})
