import type { PublicationDetail, Source } from './api/types'
import { escapeMarkdown } from './digest'
import { sourceTypeLabel } from './feedQuery'
import { formatCategory, formatPriority, formatSourceName } from './format'

export type ReportItem = {
  id: string
  comment: string
  captured_at: string
  detail: PublicationDetail
  source: Pick<Source, 'id' | 'name' | 'type'> | null
}
export type ReportDraft = {
  schema_version: 1
  title: string
  summary: string
  updated_at: string
  items: ReportItem[]
}
export const emptyDraft = (): ReportDraft => ({
  schema_version: 1,
  title: 'Обзор для руководителя',
  summary: '',
  updated_at: new Date().toISOString(),
  items: [],
})
export const decisionLabels = {
  confirmed: 'Подтверждено',
  corrected: 'Скорректировано',
  rejected: 'Отклонено',
}
export function decisionStatus(detail: PublicationDetail) {
  const decision = detail.latest_decision
  if (!decision) return 'Нет решения специалиста'
  const label = decisionLabels[decision.status]
  return decision.analysis_id === detail.latest_analysis?.id
    ? `Специалист: ${label.toLowerCase()}`
    : `Предыдущая версия: ${label.toLowerCase()}`
}
export function snapshotChanged(item: ReportItem, detail: PublicationDetail) {
  return (
    item.detail.latest_analysis?.id !== detail.latest_analysis?.id ||
    item.detail.latest_decision?.id !== detail.latest_decision?.id ||
    item.detail.publication.latest_revision_id !==
      detail.publication.latest_revision_id ||
    item.detail.publication.updated_at !== detail.publication.updated_at
  )
}
export function captureItem(
  detail: PublicationDetail,
  source?: Source,
): ReportItem {
  return JSON.parse(
    JSON.stringify({
      id: detail.publication.id,
      comment: '',
      captured_at: new Date().toISOString(),
      detail,
      source: source
        ? { id: source.id, name: source.name, type: source.type }
        : null,
    }),
  ) as ReportItem
}
// Storage is a trust boundary: validate all fields used by the editor and exports.
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string'
const date = (v: unknown) => str(v) && Number.isFinite(Date.parse(v))
const strings = (v: unknown) => Array.isArray(v) && v.every(str)
const categories = [
  'regulation',
  'reputation',
  'competitor',
  'trend',
  'unknown',
]
const priorities = ['critical', 'high', 'medium', 'low', 'unknown']
export function validDetail(v: unknown): v is PublicationDetail {
  if (!object(v) || !object(v.publication)) return false
  const p = v.publication
  if (
    ![
      'id',
      'title',
      'content',
      'source_id',
      'original_url',
      'content_hash',
    ].every((k) => str(p[k])) ||
    !date(p.published_at) ||
    !date(p.updated_at) ||
    !strings(p.tags) ||
    typeof p.is_hidden !== 'boolean'
  )
    return false
  const a = v.latest_analysis
  if (
    a !== null &&
    (!object(a) ||
      !str(a.id) ||
      !str(a.summary) ||
      !Number.isInteger(a.version) ||
      !date(a.created_at) ||
      !categories.includes(String(a.category)) ||
      !priorities.includes(String(a.proposed_priority)) ||
      !strings(a.facts) ||
      !Array.isArray(a.entities) ||
      !a.entities.every((e) => object(e) && str(e.type) && str(e.value)) ||
      !object(a.criteria) ||
      !Array.isArray(a.evidence) ||
      !a.evidence.every((e) => object(e) && str(e.claim) && str(e.quote)) ||
      !(
        a.importance_score === null ||
        (Number.isInteger(a.importance_score) &&
          Number(a.importance_score) >= 0 &&
          Number(a.importance_score) <= 18)
      ) ||
      typeof a.uncertainty !== 'number' ||
      a.uncertainty < 0 ||
      a.uncertainty > 1 ||
      typeof a.needs_review !== 'boolean')
  )
    return false
  const d = v.latest_decision
  return (
    d === null ||
    (object(d) &&
      str(d.id) &&
      str(d.analysis_id) &&
      Number.isInteger(d.version) &&
      ['confirmed', 'corrected', 'rejected'].includes(String(d.status)) &&
      categories.includes(String(d.final_category)) &&
      priorities.includes(String(d.final_priority)) &&
      (d.final_summary === null || str(d.final_summary)) &&
      (d.comment === null || str(d.comment)) &&
      str(d.author_id) &&
      date(d.created_at))
  )
}
export function parseDraft(raw: string): ReportDraft {
  const v: unknown = JSON.parse(raw)
  if (
    !object(v) ||
    v.schema_version !== 1 ||
    !str(v.title) ||
    !str(v.summary) ||
    !date(v.updated_at) ||
    !Array.isArray(v.items) ||
    !v.items.every(
      (i) =>
        object(i) &&
        str(i.id) &&
        str(i.comment) &&
        date(i.captured_at) &&
        validDetail(i.detail) &&
        i.id === i.detail.publication.id &&
        (i.source === null ||
          (object(i.source) &&
            str(i.source.id) &&
            str(i.source.name) &&
            str(i.source.type))),
    )
  ) {
    throw new Error('Не удалось прочитать сохранённый черновик')
  }
  if (new Set(v.items.map((i) => i.id)).size !== v.items.length)
    throw new Error('Повторяющиеся материалы в хранилище')
  return v as ReportDraft
}
export function safeUrl(value: string) {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}
export function reportMarkdown(draft: ReportDraft) {
  const e = (value: string) => escapeMarkdown(value).replace(/</g, '&lt;')
  return [
    '# RegRadar · ' + e(draft.title),
    '',
    e(draft.summary),
    '',
    'Снимок локального отчёта. Статусы относятся к сохранённым версиям анализа.',
    '',
    ...draft.items.flatMap((item, index) => {
      const {
        publication: p,
        latest_analysis: a,
        latest_decision: d,
      } = item.detail
      const current = d && d.analysis_id === a?.id
      return [
        `## ${index + 1}. ${e(p.title)}`,
        '',
        `Источник: ${e(formatSourceName(item.source?.name ?? p.source_id))} · ${e(item.source ? sourceTypeLabel(item.source.type) : 'Тип недоступен')}`,
        `Дата публикации: ${p.published_at}`,
        `Оригинал: ${e(safeUrl(p.original_url) ?? 'Недопустимая ссылка')}`,
        `Видимость: ${p.is_hidden ? 'скрыта' : 'активна'}`,
        '',
        `${a ? 'AI-саммари' : 'Фрагмент исходного материала (анализа нет)'}: ${e(a?.summary ?? p.content.slice(0, 500))}`,
        '',
        `Категория AI: ${formatCategory(a?.category ?? 'unknown')}`,
        `AI-приоритет: ${formatPriority(a?.proposed_priority ?? 'unknown')}`,
        `Флаг AI: ${a ? (a.needs_review ? 'Требует проверки' : 'Не запрашивает проверку') : 'Нет анализа'}`,
        `Неопределённость: ${a ? `${Math.round(a.uncertainty * 100)}%` : 'Нет данных'}`,
        `Решение: ${decisionStatus(item.detail)}`,
        ...(d
          ? [
              `${current ? 'Финальный приоритет' : 'Приоритет предыдущего решения'}: ${formatPriority(d.final_priority)}`,
              `Категория решения: ${formatCategory(d.final_category)}`,
              `Саммари специалиста: ${e(d.final_summary ?? 'Не указано')}`,
              `Комментарий специалиста: ${e(d.comment ?? 'Не указан')}`,
              `Автор: ${e(d.author_id)}`,
            ]
          : []),
        `Версия AI: ${a ? `${e(a.id)} · v${a.version}` : 'Нет'}`,
        `Версия решения: ${d ? `${e(d.id)} · v${d.version}` : 'Нет'}`,
        `Снимок: ${item.captured_at}`,
        '',
        `Теги: ${p.tags.map(e).join(', ') || 'Нет'}`,
        '',
        ...(a?.evidence.flatMap((ev) => [
          `**${e(ev.claim)}**`,
          `> ${e(ev.quote)}`,
          '',
        ]) ?? []),
        `Комментарий для менеджера: ${e(item.comment) || 'Не указан'}`,
        '',
      ]
    }),
  ].join('\n')
}
export function reportJson(draft: ReportDraft) {
  return JSON.stringify(
    {
      brand: 'RegRadar',
      exported_at: new Date().toISOString(),
      ...draft,
      items: draft.items.map((i) => ({
        ...i,
        specialist_status: decisionStatus(i.detail),
      })),
    },
    null,
    2,
  )
}
