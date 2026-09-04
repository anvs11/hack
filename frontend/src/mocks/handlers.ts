import { http, HttpResponse } from 'msw'
import type {
  ApiErrorBody,
  Category,
  Priority,
  PublicationList,
  SourceType,
} from '../shared/api/types'
import { sortPublications } from '../shared/publications'
import {
  publicationDetails,
  regulatoryCaseDetail,
  sources,
} from './fixtures'

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

  http.get('*/api/publications/:publicationId', ({ params }) => {
    const detail = publicationDetails.find(
      ({ publication: item }) => item.id === params.publicationId,
    )

    return detail ? HttpResponse.json(detail) : notFound('Публикация')
  }),

  http.get('*/api/regulatory-cases/:caseId', ({ params }) =>
    params.caseId === regulatoryCaseDetail.regulatory_case.id
      ? HttpResponse.json(regulatoryCaseDetail)
      : notFound('Регуляторный кейс'),
  ),

  http.get('*/api/sources', () => HttpResponse.json(sources)),
]
