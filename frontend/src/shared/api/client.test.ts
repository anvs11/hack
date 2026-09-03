import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../test/setup'
import { api } from './client'
import type { PublicationList } from './types'

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
})
