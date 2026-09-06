import type {
  Category,
  Priority,
  PublicationQuery,
  SourceType,
} from './api/types'
export const categories: Category[] = [
  'regulation',
  'reputation',
  'competitor',
  'trend',
  'unknown',
]
export const priorities: Priority[] = [
  'critical',
  'high',
  'medium',
  'low',
  'unknown',
]
export const sourceTypes: [SourceType, string][] = [
  ['rss', 'СМИ / RSS'],
  ['regulator', 'Регулятор'],
  ['telegram', 'Telegram'],
  ['file', 'Файл'],
]
export const sourceTypeLabel = (type?: string) =>
  sourceTypes.find((s) => s[0] === type)?.[1] ?? 'Тип недоступен'
export const filterLabels: Record<string, string> = {
  q: 'Поиск',
  category: 'Категория',
  proposed_priority: 'Приоритет AI',
  source_id: 'Источник',
  source_type: 'Тип',
  needs_review: 'Флаг AI',
  visibility: 'Видимость',
  published_from: 'С',
  published_to: 'По',
}
const allowed = <T extends string>(
  value: string | null,
  options: T[],
): T | undefined => (options.includes(value as T) ? (value as T) : undefined)
export function parseFeedQuery(params: URLSearchParams): PublicationQuery {
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const raw = params.get(key)
    const n = Number(raw)
    return raw &&
      /^\d+$/.test(raw) &&
      Number.isSafeInteger(n) &&
      n >= min &&
      n <= max
      ? n
      : fallback
  }
  return {
    q: params.get('q')?.trim() || undefined,
    source_id: params.get('source_id') || undefined,
    source_type: allowed(
      params.get('source_type'),
      sourceTypes.map((s) => s[0]),
    ),
    category: allowed(params.get('category'), categories),
    proposed_priority: allowed(params.get('proposed_priority'), priorities),
    needs_review:
      params.get('needs_review') === 'true'
        ? true
        : params.get('needs_review') === 'false'
          ? false
          : undefined,
    visibility: allowed(params.get('visibility'), ['active', 'hidden', 'all']),
    published_from: params.get('published_from') || undefined,
    published_to: params.get('published_to') || undefined,
    limit: integer('limit', 10, 1, 100),
    offset: integer('offset', 0, 0, Number.MAX_SAFE_INTEGER),
  }
}
export function dateError(query: PublicationQuery) {
  const dates = [query.published_from, query.published_to].filter(
    Boolean,
  ) as string[]
  if (
    dates.some(
      (d) => !/^\d{4}-\d{2}-\d{2}T/.test(d) || !Number.isFinite(Date.parse(d)),
    )
  )
    return 'Некорректная дата в адресе. Укажите период заново.'
  if (
    query.published_from &&
    query.published_to &&
    Date.parse(query.published_from) > Date.parse(query.published_to)
  )
    return 'Начало периода должно быть не позже окончания.'
  return ''
}
export function dateBoundary(day: string, end = false) {
  if (!day) return ''
  const iso = new Date(
    `${day}T${end ? '23:59:59.999' : '00:00:00.000'}`,
  ).toISOString()
  // The API uses inclusive datetime bounds with microsecond precision.
  return end ? iso.replace('.999Z', '.999999Z') : iso
}
export function localDay(iso?: string) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
