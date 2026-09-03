import type {
  PublicationDetail,
  PublicationList,
  PublicationQuery,
  RegulatoryCaseDetail,
  Source,
} from './types'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function apiUrl(path: `/api/${string}`) {
  return `${API_BASE_URL}${path}`
}

function withQuery(path: `/api/${string}`, query: PublicationQuery) {
  const searchParams = new URLSearchParams()

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined) searchParams.set(key, String(value))
  })

  const queryString = searchParams.toString()
  return `${path}${queryString ? `?${queryString}` : ''}` as `/api/${string}`
}

async function request<T>(path: `/api/${string}`, signal?: AbortSignal): Promise<T> {
  const response = await fetch(apiUrl(path), {
    headers: { Accept: 'application/json' },
    signal,
  })

  if (!response.ok) {
    let message = `API returned ${response.status}`

    try {
      const body = (await response.json()) as { message?: string }
      message = body.message ?? message
    } catch {
      // The status code remains useful when an error body is not JSON.
    }

    throw new ApiError(message, response.status)
  }

  return (await response.json()) as T
}

export const api = {
  listPublications: (query: PublicationQuery = {}, signal?: AbortSignal) =>
    request<PublicationList>(withQuery('/api/publications', query), signal),
  getPublication: (id: string, signal?: AbortSignal) =>
    request<PublicationDetail>(`/api/publications/${encodeURIComponent(id)}`, signal),
  getRegulatoryCase: (id: string, signal?: AbortSignal) =>
    request<RegulatoryCaseDetail>(
      `/api/regulatory-cases/${encodeURIComponent(id)}`,
      signal,
    ),
  listSources: (signal?: AbortSignal) => request<Source[]>('/api/sources', signal),
}
