import { http, HttpResponse } from 'msw'
import type { ApiErrorBody } from '../shared/api/types'
import {
  publicationDetails,
  publicationList,
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
  http.get('*/api/publications', () => HttpResponse.json(publicationList)),

  http.get('*/api/publications/:publicationId', ({ params }) => {
    const detail = publicationDetails.find(
      ({ publication: item }) => item.id === params.publicationId,
    )

    return detail ? HttpResponse.json(detail) : notFound('Публикация')
  }),

  http.get('*/api/regulatory-cases/:caseId', ({ params }) =>
    params.caseId === regulatoryCaseDetail.case.id
      ? HttpResponse.json(regulatoryCaseDetail)
      : notFound('Регуляторный кейс'),
  ),

  http.get('*/api/sources', () => HttpResponse.json(sources)),
]
