import type {
  CollectionReport,
  LifecycleEvent,
  LifecycleEventCreate,
  PublicationDetail,
  PublicationHistory,
  PublicationList,
  PublicationQuery,
  RegulatoryCaseDetail,
  RegulatoryCase,
  Source,
  SourceCreate,
  SourcePatch,
  SpecialistDecision,
  SpecialistDecisionCreate,
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

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH'
  body?: unknown
  signal?: AbortSignal
}

async function request<T>(path: `/api/${string}`, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
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

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const api = {
  listPublications: (query: PublicationQuery = {}, signal?: AbortSignal) =>
    request<PublicationList>(withQuery('/api/publications', query), { signal }),
  getPublication: (id: string, signal?: AbortSignal) =>
    request<PublicationDetail>(`/api/publications/${encodeURIComponent(id)}`, { signal }),
  getPublicationHistory: (id: string, signal?: AbortSignal) =>
    request<PublicationHistory>(
      `/api/publications/${encodeURIComponent(id)}/history`,
      { signal },
    ),
  createSpecialistDecision: (
    publicationId: string,
    decision: SpecialistDecisionCreate,
    signal?: AbortSignal,
  ) => request<SpecialistDecision>(
    `/api/publications/${encodeURIComponent(publicationId)}/decisions`,
    { method: 'POST', body: decision, signal },
  ),
  listRegulatoryCases: (signal?: AbortSignal) =>
    request<RegulatoryCase[]>('/api/regulatory-cases', { signal }),
  linkPublicationToCase: (
    caseId: string,
    publicationId: string,
    signal?: AbortSignal,
  ) => request<void>(
    `/api/regulatory-cases/${encodeURIComponent(caseId)}/publications/${encodeURIComponent(publicationId)}`,
    { method: 'PUT', signal },
  ),
  getRegulatoryCase: (id: string, signal?: AbortSignal) =>
    request<RegulatoryCaseDetail>(
      `/api/regulatory-cases/${encodeURIComponent(id)}`,
      { signal },
    ),
  createLifecycleEvent: (
    caseId: string,
    event: LifecycleEventCreate,
    signal?: AbortSignal,
  ) => request<LifecycleEvent>(
    `/api/regulatory-cases/${encodeURIComponent(caseId)}/lifecycle-events`,
    { method: 'POST', body: event, signal },
  ),
  listSources: (signal?: AbortSignal) => request<Source[]>('/api/sources', { signal }),
  createSource: (payload: SourceCreate, signal?: AbortSignal) =>
    request<Source>('/api/sources', { method: 'POST', body: payload, signal }),
  updateSource: (sourceId: string, patch: SourcePatch, signal?: AbortSignal) =>
    request<Source>(`/api/sources/${encodeURIComponent(sourceId)}`, {
      method: 'PATCH',
      body: patch,
      signal,
    }),
  collectSource: (sourceId: string, signal?: AbortSignal) =>
    request<CollectionReport>(
      `/api/sources/${encodeURIComponent(sourceId)}/collections`,
      { method: 'POST', signal },
    ),
}
