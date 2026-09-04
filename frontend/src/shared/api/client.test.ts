import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../test/setup'
import { ApiError, api } from './client'
import { publicationHistory, regulatoryCases, sources } from '../../mocks/fixtures'
import type {
  CollectionReport,
  LifecycleEvent,
  LifecycleEventCreate,
  PublicationList,
  Source,
  SourceCreate,
  SourcePatch,
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

  it('creates a lifecycle event through the encoded contract path and JSON body', async () => {
    let received: LifecycleEventCreate | null = null
    let requestedPath = ''
    const payload = {
      stage: 'introduced',
      occurred_at: '2026-09-04T12:00:00.000Z',
      confirmation_url: 'https://regulator.example/events/42',
      confirmation_source_type: 'official_publication',
      comment: 'Официально внесён.',
      author_id: 'user-gr-001',
    } satisfies LifecycleEventCreate
    server.use(
      http.post('*/api/regulatory-cases/:caseId/lifecycle-events', async ({ request }) => {
        requestedPath = new URL(request.url).pathname
        received = await request.json() as LifecycleEventCreate
        return HttpResponse.json({
          ...payload,
          id: 'event-client-test',
          regulatory_case_id: 'case/encoded',
          created_at: '2026-09-04T12:01:00Z',
        } satisfies LifecycleEvent, { status: 201 })
      }),
    )

    const lifecycleEvent = await api.createLifecycleEvent('case/encoded', payload)

    expect(requestedPath).toBe('/api/regulatory-cases/case%2Fencoded/lifecycle-events')
    expect(received).toEqual(payload)
    expect(lifecycleEvent.stage).toBe('introduced')
  })
})

describe('source API client', () => {
  it('creates a source with the exact JSON body', async () => {
    let received: SourceCreate | null = null
    const payload = {
      name: 'Новая RSS-лента',
      type: 'rss',
      url: 'https://example.org/new.xml',
      enabled: true,
    } satisfies SourceCreate
    server.use(
      http.post('*/api/sources', async ({ request }) => {
        received = await request.json() as SourceCreate
        return HttpResponse.json({
          ...payload,
          id: 'source-client-test',
          last_checked_at: null,
          last_success_at: null,
          last_error: null,
          is_demo: false,
        } satisfies Source, { status: 201 })
      }),
    )

    const created = await api.createSource(payload)

    expect(received).toEqual(payload)
    expect(created.id).toBe('source-client-test')
  })

  it('patches a URL-encoded source ID with the exact JSON body', async () => {
    let requestedPath = ''
    let received: SourcePatch | null = null
    const patch = { name: 'Обновлённый источник', enabled: false } satisfies SourcePatch
    server.use(
      http.patch('*/api/sources/:sourceId', async ({ request }) => {
        requestedPath = new URL(request.url).pathname
        received = await request.json() as SourcePatch
        return HttpResponse.json({ ...sources[0], ...patch })
      }),
    )

    await api.updateSource('source/encoded', patch)

    expect(requestedPath).toBe('/api/sources/source%2Fencoded')
    expect(received).toEqual(patch)
  })

  it('collects an encoded source and returns a typed CollectionReport', async () => {
    let requestedPath = ''
    const report = {
      status: 'completed',
      started_at: '2026-09-04T12:00:00Z',
      finished_at: '2026-09-04T12:00:05Z',
      sources: [{
        source_id: 'source/encoded',
        status: 'success',
        collected: 3,
        created: 2,
        exact_duplicates: 1,
        semantic_candidates: 1,
        error: null,
      }],
      collected: 3,
      created: 2,
      exact_duplicates: 1,
      semantic_candidates: 1,
    } satisfies CollectionReport
    server.use(
      http.post('*/api/sources/:sourceId/collections', ({ request }) => {
        requestedPath = new URL(request.url).pathname
        return HttpResponse.json(report)
      }),
    )

    const result: CollectionReport = await api.collectSource('source/encoded')

    expect(requestedPath).toBe('/api/sources/source%2Fencoded/collections')
    expect(result.sources[0].status).toBe('success')
  })

  it('throws ApiError for an unsuccessful source response', async () => {
    server.use(
      http.post('*/api/sources', () =>
        HttpResponse.json({ message: 'Источник отклонён' }, { status: 422 }),
      ),
    )

    const request = api.createSource({
      name: 'Невалидный',
      type: 'rss',
      url: 'https://example.org/feed',
    })

    const error = await request.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      name: 'ApiError',
      status: 422,
      message: 'Источник отклонён',
    })
  })
})
