import { http, HttpResponse } from 'msw'
import type {
  ApiErrorBody,
  Category,
  LifecycleEvent,
  LifecycleEventCreate,
  LifecycleStage,
  Priority,
  PublicationList,
  SpecialistDecision,
  SpecialistDecisionCreate,
  SourceType,
} from '../shared/api/types'
import { sortPublications } from '../shared/publications'
import {
  publicationDetails,
  publicationHistory,
  regulatoryCaseDetail,
  regulatoryCases,
  sources,
} from './fixtures'

let decisions: SpecialistDecision[] = [...publicationHistory.decisions]
let linkedPublicationIds = new Set(
  regulatoryCaseDetail.regulatory_case.related_publication_ids,
)
let lifecycleEvents: LifecycleEvent[] = [...regulatoryCaseDetail.timeline]
let currentStage: LifecycleStage = regulatoryCaseDetail.regulatory_case.current_stage

const allowedTransitions: Record<LifecycleStage, LifecycleStage[]> = {
  draft: ['introduced'],
  introduced: ['adopted'],
  adopted: ['published'],
  published: ['effective'],
  effective: ['amended', 'repealed'],
  amended: ['effective', 'repealed'],
  repealed: [],
}

export function resetMockState() {
  decisions = [...publicationHistory.decisions]
  linkedPublicationIds = new Set(
    regulatoryCaseDetail.regulatory_case.related_publication_ids,
  )
  lifecycleEvents = [...regulatoryCaseDetail.timeline]
  currentStage = regulatoryCaseDetail.regulatory_case.current_stage
}

const notFound = (resource: string) =>
  HttpResponse.json(
    {
      code: 'not_found',
      message: `${resource} не найден`,
    } satisfies ApiErrorBody,
    { status: 404 },
  )

export const handlers = [
  http.get('*/api/publications', ({ request }) => {
    const params = new URL(request.url).searchParams
    const q = params.get('q')?.trim().toLocaleLowerCase('ru')
    const sourceId = params.get('source_id')
    const sourceType = params.get('source_type') as SourceType | null
    const category = params.get('category') as Category | null
    const proposedPriority = params.get('proposed_priority') as Priority | null
    const needsReview = params.get('needs_review')
    const parsedLimit = Number(params.get('limit') ?? 20)
    const parsedOffset = Number(params.get('offset') ?? 0)
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(Math.floor(parsedLimit), 100)
      : 20
    const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0
      ? Math.floor(parsedOffset)
      : 0

    const filtered = publicationDetails.filter(({ publication, latest_analysis: analysis }) => {
      const source = sources.find((item) => item.id === publication.source_id)
      const searchableText = [
        publication.title,
        publication.content,
        analysis?.summary,
        analysis?.category,
        ...(analysis?.entities.map((entity) => entity.value) ?? []),
      ].filter(Boolean).join(' ').toLocaleLowerCase('ru')

      return (
        (!q || searchableText.includes(q)) &&
        (!sourceId || publication.source_id === sourceId) &&
        (!sourceType || source?.type === sourceType) &&
        (!category || analysis?.category === category) &&
        (!proposedPriority || analysis?.proposed_priority === proposedPriority) &&
        (needsReview === null || analysis?.needs_review === (needsReview === 'true'))
      )
    })

    const sorted = sortPublications(filtered)

    return HttpResponse.json({
      items: sorted.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
    } satisfies PublicationList)
  }),

  http.get('*/api/publications/:publicationId/history', ({ params }) => {
    if (params.publicationId !== publicationHistory.publication_id) {
      const detail = publicationDetails.find(
        ({ publication }) => publication.id === params.publicationId,
      )
      return detail
        ? HttpResponse.json({
            publication_id: detail.publication.id,
            analyses: detail.latest_analysis ? [detail.latest_analysis] : [],
            decisions: [],
          })
        : notFound('Публикация')
    }
    return HttpResponse.json({ ...publicationHistory, decisions })
  }),

  http.post('*/api/publications/:publicationId/decisions', async ({ params, request }) => {
    const detail = publicationDetails.find(
      ({ publication }) => publication.id === params.publicationId,
    )
    if (!detail) return notFound('Публикация')

    const body = await request.json() as SpecialistDecisionCreate
    const availableAnalyses = params.publicationId === publicationHistory.publication_id
      ? publicationHistory.analyses
      : detail.latest_analysis ? [detail.latest_analysis] : []
    const analysis = availableAnalyses.find((item) => item.id === body.analysis_id)
    if (!analysis) {
      return HttpResponse.json(
        { code: 'validation_error', message: 'Версия анализа не принадлежит публикации' },
        { status: 422 },
      )
    }

    const decision = {
      ...body,
      final_summary: body.final_summary ?? null,
      comment: body.comment ?? null,
      id: `decision-mock-${decisions.length + 1}`,
      publication_id: String(params.publicationId),
      version: decisions.filter(
        (item) => item.publication_id === params.publicationId,
      ).length + 1,
      created_at: new Date().toISOString(),
    } satisfies SpecialistDecision
    decisions = [...decisions, decision]
    return HttpResponse.json(decision, { status: 201 })
  }),

  http.get('*/api/publications/:publicationId', ({ params }) => {
    const detail = publicationDetails.find(
      ({ publication: item }) => item.id === params.publicationId,
    )

    if (!detail) return notFound('Публикация')
    const latestDecision = decisions
      .filter((item) => item.publication_id === params.publicationId)
      .at(-1) ?? detail.latest_decision
    return HttpResponse.json({ ...detail, latest_decision: latestDecision })
  }),

  http.get('*/api/regulatory-cases', () => HttpResponse.json(
    regulatoryCases.map((item) => ({
      ...item,
      related_publication_ids: [...linkedPublicationIds],
      current_stage: currentStage,
    })),
  )),

  http.put('*/api/regulatory-cases/:caseId/publications/:publicationId', ({ params }) => {
    const regulatoryCase = regulatoryCases.find((item) => item.id === params.caseId)
    const publication = publicationDetails.find(
      ({ publication: item }) => item.id === params.publicationId,
    )
    if (!regulatoryCase) return notFound('Регуляторный кейс')
    if (!publication) return notFound('Публикация')
    linkedPublicationIds.add(String(params.publicationId))
    return new HttpResponse(null, { status: 204 })
  }),

  http.get('*/api/regulatory-cases/:caseId', ({ params }) =>
    params.caseId === regulatoryCaseDetail.regulatory_case.id
      ? HttpResponse.json({
          ...regulatoryCaseDetail,
          timeline: lifecycleEvents,
          regulatory_case: {
            ...regulatoryCaseDetail.regulatory_case,
            related_publication_ids: [...linkedPublicationIds],
            current_stage: currentStage,
          },
        })
      : notFound('Регуляторный кейс'),
  ),

  http.post('*/api/regulatory-cases/:caseId/lifecycle-events', async ({ params, request }) => {
    if (params.caseId !== regulatoryCaseDetail.regulatory_case.id) {
      return notFound('Регуляторный кейс')
    }

    const body = await request.json() as LifecycleEventCreate
    const sourceType = body.confirmation_source_type as string
    if (
      !body.stage ||
      !body.occurred_at ||
      !body.confirmation_url ||
      !body.author_id ||
      !['regulator', 'official_publication'].includes(sourceType)
    ) {
      return HttpResponse.json(
        { code: 'validation_error', message: 'Поля официального события невалидны' },
        { status: 422 },
      )
    }

    const isInitialConfirmation = lifecycleEvents.length === 0 && body.stage === currentStage
    if (!isInitialConfirmation && !allowedTransitions[currentStage].includes(body.stage)) {
      return HttpResponse.json(
        {
          code: 'conflict',
          message: 'Недопустимый переход стадии regulatory case',
          details: { current_stage: currentStage, requested_stage: body.stage },
        } satisfies ApiErrorBody,
        { status: 409 },
      )
    }

    const createdAt = new Date().toISOString()
    const lifecycleEvent = {
      ...body,
      occurred_at: new Date(body.occurred_at).toISOString(),
      comment: body.comment ?? null,
      id: `event-mock-${lifecycleEvents.length + 1}`,
      regulatory_case_id: String(params.caseId),
      created_at: createdAt,
    } satisfies LifecycleEvent
    lifecycleEvents = [...lifecycleEvents, lifecycleEvent]
    currentStage = body.stage
    return HttpResponse.json(lifecycleEvent, { status: 201 })
  }),

  http.get('*/api/sources', () => HttpResponse.json(sources)),
]
