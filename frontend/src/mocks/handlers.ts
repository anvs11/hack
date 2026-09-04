import { http, HttpResponse } from 'msw'
import type {
  ApiErrorBody,
  Category,
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

export function resetMockState() {
  decisions = [...publicationHistory.decisions]
  linkedPublicationIds = new Set(
    regulatoryCaseDetail.regulatory_case.related_publication_ids,
  )
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
          regulatory_case: {
            ...regulatoryCaseDetail.regulatory_case,
            related_publication_ids: [...linkedPublicationIds],
          },
        })
      : notFound('Регуляторный кейс'),
  ),

  http.get('*/api/sources', () => HttpResponse.json(sources)),
]
