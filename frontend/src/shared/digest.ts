import { api } from './api/client'
import type {
  Category,
  ConfirmationSourceType,
  DecisionStatus,
  LifecycleStage,
  Priority,
  PublicationDetail,
  PublicationHistory,
  RegulatoryCaseDetail,
  Source,
} from './api/types'

export type DigestCriticalMaterial = {
  id: string
  publication_id: string
  title: string
  summary: string
  category: Category
  priority: Priority
  decision_status: DecisionStatus
  author_id: string
  decided_at: string
  source_id: string
  source_name: string
  publication_path: string
  original_url: string
}

export type DigestLifecycleChange = {
  id: string
  regulatory_case_id: string
  case_title: string
  registration_number: string
  from_stage: LifecycleStage | null
  stage: LifecycleStage
  occurred_at: string
  confirmation_source_type: ConfirmationSourceType
  confirmation_url: string
  comment: string | null
  author_id: string
  created_at: string
  case_path: string
}

export type DigestReviewItem = {
  id: string
  publication_id: string
  analysis_id: string
  title: string
  summary: string
  category: Category
  proposed_priority: Priority
  uncertainty: number
  source_id: string
  source_name: string
  published_at: string
  publication_path: string
  original_url: string
}

export type DigestSpecialistDecisionAction = {
  type: 'specialist_decision'
  id: string
  publication_id: string
  publication_title: string
  status: DecisionStatus
  final_category: Category
  final_priority: Priority
  comment: string | null
  author_id: string
  created_at: string
  publication_path: string
}

export type DigestLifecycleEventAction = {
  type: 'lifecycle_event'
  id: string
  regulatory_case_id: string
  case_title: string
  stage: LifecycleStage
  confirmation_source_type: ConfirmationSourceType
  confirmation_url: string
  comment: string | null
  author_id: string
  created_at: string
  occurred_at: string
  case_path: string
}

export type DigestUserAction =
  | DigestSpecialistDecisionAction
  | DigestLifecycleEventAction

export type DigestSnapshot = {
  schema_version: '1.0'
  generated_at: string
  scope: {
    kind: 'all_available_data'
  }
  summary: {
    critical_materials: number
    lifecycle_changes: number
    review_queue: number
    user_actions: number
  }
  critical_materials: DigestCriticalMaterial[]
  lifecycle_changes: DigestLifecycleChange[]
  review_queue: DigestReviewItem[]
  user_actions: DigestUserAction[]
}

export type DigestSourceData = {
  publications: PublicationDetail[]
  publication_histories: PublicationHistory[]
  regulatory_cases: RegulatoryCaseDetail[]
  sources: Source[]
}

const categoryLabels: Record<Category, string> = {
  regulation: 'Регуляторика',
  reputation: 'Репутация',
  competitor: 'Конкуренты',
  trend: 'Тренды',
  unknown: 'Не определено',
}

const priorityLabels: Record<Priority, string> = {
  critical: 'Критический',
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
  unknown: 'Не определено',
}

const statusLabels: Record<DecisionStatus, string> = {
  confirmed: 'Подтверждено',
  corrected: 'Скорректировано',
  rejected: 'Отклонено',
}

const stageLabels: Record<LifecycleStage, string> = {
  draft: 'Проект',
  introduced: 'Внесён',
  adopted: 'Принят',
  published: 'Опубликован',
  effective: 'Вступил в силу',
  amended: 'Изменён',
  repealed: 'Отменён',
}

const confirmationSourceLabels: Record<ConfirmationSourceType, string> = {
  regulator: 'Регулятор',
  official_publication: 'Официальное опубликование',
}

const compareText = (left: string, right: string) => left.localeCompare(right, 'en')

const compareAscendingDates = (left: string, right: string) =>
  left.localeCompare(right)

const compareDescendingDates = (left: string, right: string) =>
  right.localeCompare(left)

function sourceName(sourceId: string, sourcesById: ReadonlyMap<string, Source>) {
  return sourcesById.get(sourceId)?.name ?? `Источник ${sourceId}`
}

export function buildDigestSnapshot(
  data: DigestSourceData,
  generatedAt: string,
): DigestSnapshot {
  const sourcesById = new Map(data.sources.map((source) => [source.id, source]))
  const publicationsById = new Map(
    data.publications.map((detail) => [detail.publication.id, detail]),
  )

  const criticalMaterials = data.publications
    .filter(({ latest_analysis: analysis, latest_decision: decision }) =>
      analysis !== null &&
      decision !== null &&
      decision.analysis_id === analysis.id &&
      (decision.status === 'confirmed' || decision.status === 'corrected') &&
      decision.final_priority === 'critical',
    )
    .map(({ publication, latest_analysis: analysis, latest_decision: decision }) => {
      if (analysis === null || decision === null) {
        throw new Error('Critical material invariant was violated')
      }

      return {
        id: decision.id,
        publication_id: publication.id,
        title: publication.title,
        summary: decision.final_summary ?? analysis.summary,
        category: decision.final_category,
        priority: decision.final_priority,
        decision_status: decision.status,
        author_id: decision.author_id,
        decided_at: decision.created_at,
        source_id: publication.source_id,
        source_name: sourceName(publication.source_id, sourcesById),
        publication_path: `/publications/${encodeURIComponent(publication.id)}`,
        original_url: publication.original_url,
      } satisfies DigestCriticalMaterial
    })
    .sort((left, right) =>
      compareDescendingDates(left.decided_at, right.decided_at) ||
      compareText(left.publication_id, right.publication_id) ||
      compareText(left.id, right.id),
    )

  const reviewQueue = data.publications
    .filter(({ latest_analysis: analysis, latest_decision: decision }) =>
      analysis?.needs_review === true &&
      (decision === null || decision.analysis_id !== analysis.id),
    )
    .map(({ publication, latest_analysis: analysis }) => {
      if (analysis === null) throw new Error('Review item invariant was violated')

      return {
        id: publication.id,
        publication_id: publication.id,
        analysis_id: analysis.id,
        title: publication.title,
        summary: analysis.summary,
        category: analysis.category,
        proposed_priority: analysis.proposed_priority,
        uncertainty: analysis.uncertainty,
        source_id: publication.source_id,
        source_name: sourceName(publication.source_id, sourcesById),
        published_at: publication.published_at,
        publication_path: `/publications/${encodeURIComponent(publication.id)}`,
        original_url: publication.original_url,
      } satisfies DigestReviewItem
    })
    .sort((left, right) =>
      compareDescendingDates(left.published_at, right.published_at) ||
      compareText(left.publication_id, right.publication_id),
    )

  const lifecycleChanges = data.regulatory_cases.flatMap((detail) => {
    const timeline = [...detail.timeline].sort((left, right) =>
      compareAscendingDates(left.occurred_at, right.occurred_at) ||
      compareAscendingDates(left.created_at, right.created_at) ||
      compareText(left.id, right.id),
    )

    return timeline.map((event, index) => ({
      id: event.id,
      regulatory_case_id: detail.regulatory_case.id,
      case_title: detail.regulatory_case.title,
      registration_number: detail.regulatory_case.registration_number,
      from_stage: index === 0 ? null : timeline[index - 1].stage,
      stage: event.stage,
      occurred_at: event.occurred_at,
      confirmation_source_type: event.confirmation_source_type,
      confirmation_url: event.confirmation_url,
      comment: event.comment,
      author_id: event.author_id,
      created_at: event.created_at,
      case_path: `/regulatory-cases/${encodeURIComponent(detail.regulatory_case.id)}`,
    } satisfies DigestLifecycleChange))
  }).sort((left, right) =>
    compareDescendingDates(left.occurred_at, right.occurred_at) ||
    compareText(left.regulatory_case_id, right.regulatory_case_id) ||
    compareText(left.id, right.id),
  )

  const decisionActions: DigestSpecialistDecisionAction[] = data.publication_histories
    .flatMap((history) => history.decisions.map((decision) => {
      const detail = publicationsById.get(decision.publication_id)
      return {
        type: 'specialist_decision',
        id: decision.id,
        publication_id: decision.publication_id,
        publication_title: detail?.publication.title ?? `Публикация ${decision.publication_id}`,
        status: decision.status,
        final_category: decision.final_category,
        final_priority: decision.final_priority,
        comment: decision.comment,
        author_id: decision.author_id,
        created_at: decision.created_at,
        publication_path: `/publications/${encodeURIComponent(decision.publication_id)}`,
      }
    }))

  const lifecycleActions: DigestLifecycleEventAction[] = data.regulatory_cases
    .flatMap((detail) => detail.timeline.map((event) => ({
      type: 'lifecycle_event',
      id: event.id,
      regulatory_case_id: detail.regulatory_case.id,
      case_title: detail.regulatory_case.title,
      stage: event.stage,
      confirmation_source_type: event.confirmation_source_type,
      confirmation_url: event.confirmation_url,
      comment: event.comment,
      author_id: event.author_id,
      created_at: event.created_at,
      occurred_at: event.occurred_at,
      case_path: `/regulatory-cases/${encodeURIComponent(detail.regulatory_case.id)}`,
    })))

  const userActions: DigestUserAction[] = [...decisionActions, ...lifecycleActions]
    .sort((left, right) =>
      compareDescendingDates(left.created_at, right.created_at) ||
      compareText(left.type, right.type) ||
      compareText(left.id, right.id),
    )

  return {
    schema_version: '1.0',
    generated_at: generatedAt,
    scope: { kind: 'all_available_data' },
    summary: {
      critical_materials: criticalMaterials.length,
      lifecycle_changes: lifecycleChanges.length,
      review_queue: reviewQueue.length,
      user_actions: userActions.length,
    },
    critical_materials: criticalMaterials,
    lifecycle_changes: lifecycleChanges,
    review_queue: reviewQueue,
    user_actions: userActions,
  }
}

async function loadAllPublications(signal: AbortSignal) {
  const limit = 100
  const publications: PublicationDetail[] = []
  let offset = 0
  let total = 0

  do {
    const page = await api.listPublications({ limit, offset }, signal)
    publications.push(...page.items)
    total = page.total
    offset += page.items.length

    if (page.items.length === 0 && offset < total) {
      throw new Error('API публикаций вернул пустую страницу до достижения total')
    }
  } while (offset < total)

  return publications
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(values[index])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  )
  return results
}

export async function loadDigestSourceData(signal: AbortSignal): Promise<DigestSourceData> {
  const [publications, regulatoryCases, sources] = await Promise.all([
    loadAllPublications(signal),
    api.listRegulatoryCases(signal),
    api.listSources(signal),
  ])

  const publicationIdsWithHistory = [...new Set(
    publications
      .filter((detail) => detail.latest_decision !== null)
      .map((detail) => detail.publication.id),
  )]
  const caseIds = [...new Set(regulatoryCases.map((regulatoryCase) => regulatoryCase.id))]

  const publicationHistories = await mapWithConcurrency(
    publicationIdsWithHistory,
    5,
    (id) => api.getPublicationHistory(id, signal),
  )
  const regulatoryCaseDetails = await mapWithConcurrency(
    caseIds,
    5,
    (id) => api.getRegulatoryCase(id, signal),
  )

  return {
    publications,
    publication_histories: publicationHistories,
    regulatory_cases: regulatoryCaseDetails,
    sources,
  }
}

export function serializeDigestJson(snapshot: DigestSnapshot) {
  return `${JSON.stringify(snapshot, null, 2)}\n`
}

const normalizeMarkdownText = (value: string) => value.replace(/\s+/g, ' ').trim()

export function escapeMarkdown(value: string) {
  return normalizeMarkdownText(value)
    .replace(/\\/g, '\\\\')
    .replace(/([`*_{[\]}()#+\-.!|>])/g, '\\$1')
}

const markdownValue = (value: string | null) =>
  value?.trim() ? escapeMarkdown(value) : 'Не указан'

const markdownDate = (value: string) => new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'UTC',
}).format(new Date(value))

const markdownUrl = (value: string) => encodeURI(value).replace(/[()]/g, (character) =>
  character === '(' ? '%28' : '%29')

function renderMarkdownSection(
  title: string,
  items: readonly string[],
) {
  return [`## ${title}`, '', ...(items.length ? items : ['Нет элементов']), ''].join('\n')
}

export function serializeDigestMarkdown(snapshot: DigestSnapshot) {
  const critical = snapshot.critical_materials.map((item) => [
    `### ${escapeMarkdown(item.title)}`,
    '',
    `- Саммари: ${markdownValue(item.summary)}`,
    `- Категория: ${categoryLabels[item.category]}`,
    `- Приоритет: ${priorityLabels[item.priority]}`,
    `- Решение: ${statusLabels[item.decision_status]}`,
    `- Автор решения: ${escapeMarkdown(item.author_id)}`,
    `- Дата решения: ${markdownDate(item.decided_at)}`,
    `- Источник: ${escapeMarkdown(item.source_name)}`,
    `- [Карточка публикации](${item.publication_path})`,
    `- [Оригинал](${markdownUrl(item.original_url)})`,
  ].join('\n'))

  const lifecycle = snapshot.lifecycle_changes.map((item) => [
    `### ${escapeMarkdown(item.case_title)}`,
    '',
    `- Регистрационный номер: ${escapeMarkdown(item.registration_number)}`,
    item.from_stage === null
      ? `- Изменение: Зафиксирована начальная стадия — ${stageLabels[item.stage]}`
      : `- Изменение: ${stageLabels[item.from_stage]} → ${stageLabels[item.stage]}`,
    `- Фактическая дата: ${markdownDate(item.occurred_at)}`,
    `- Официальное подтверждение: ${confirmationSourceLabels[item.confirmation_source_type]}`,
    `- Комментарий: ${markdownValue(item.comment)}`,
    `- Автор: ${escapeMarkdown(item.author_id)}`,
    `- [Карточка НПА](${item.case_path})`,
    `- [Официальный источник](${markdownUrl(item.confirmation_url)})`,
  ].join('\n'))

  const review = snapshot.review_queue.map((item) => [
    `### ${escapeMarkdown(item.title)}`,
    '',
    `- AI-саммари: ${markdownValue(item.summary)}`,
    `- AI-категория: ${categoryLabels[item.category]}`,
    `- AI-приоритет: ${priorityLabels[item.proposed_priority]}`,
    `- Uncertainty: ${Math.round(item.uncertainty * 100)}%`,
    `- Источник: ${escapeMarkdown(item.source_name)}`,
    `- Дата публикации: ${markdownDate(item.published_at)}`,
    `- [Карточка публикации](${item.publication_path})`,
    `- [Оригинал](${markdownUrl(item.original_url)})`,
  ].join('\n'))

  const actions = snapshot.user_actions.map((item) => item.type === 'specialist_decision'
    ? [
        `### Решение специалиста · ${escapeMarkdown(item.publication_title)}`,
        '',
        `- Статус: ${statusLabels[item.status]}`,
        `- Финальная категория: ${categoryLabels[item.final_category]}`,
        `- Финальный приоритет: ${priorityLabels[item.final_priority]}`,
        `- Комментарий: ${markdownValue(item.comment)}`,
        `- Автор: ${escapeMarkdown(item.author_id)}`,
        `- Дата действия: ${markdownDate(item.created_at)}`,
        `- [Карточка публикации](${item.publication_path})`,
      ].join('\n')
    : [
        `### Событие НПА · ${escapeMarkdown(item.case_title)}`,
        '',
        `- Зафиксированная стадия: ${stageLabels[item.stage]}`,
        `- Официальный источник: ${confirmationSourceLabels[item.confirmation_source_type]}`,
        `- Комментарий: ${markdownValue(item.comment)}`,
        `- Автор: ${escapeMarkdown(item.author_id)}`,
        `- Дата действия: ${markdownDate(item.created_at)}`,
        `- Фактическая дата: ${markdownDate(item.occurred_at)}`,
        `- [Карточка НПА](${item.case_path})`,
        `- [Официальный источник](${markdownUrl(item.confirmation_url)})`,
      ].join('\n'))

  return [
    '# Управленческий дайджест',
    '',
    `Дата формирования: ${markdownDate(snapshot.generated_at)}`,
    '',
    'Область данных: all_available_data — все доступные данные.',
    '',
    'Клиентский снимок по текущим данным. Серверное API и хранение версий дайджеста пока не предусмотрены.',
    '',
    '## Сводка',
    '',
    `- Подтверждённые критические материалы: ${snapshot.summary.critical_materials}`,
    `- Изменения стадий НПА: ${snapshot.summary.lifecycle_changes}`,
    `- Требующие проверки карточки: ${snapshot.summary.review_queue}`,
    `- Действия пользователей: ${snapshot.summary.user_actions}`,
    '',
    renderMarkdownSection('Подтверждённые критические материалы', critical),
    renderMarkdownSection('Изменения стадий НПА', lifecycle),
    renderMarkdownSection('Требующие проверки карточки', review),
    renderMarkdownSection('Действия пользователей', actions),
  ].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

export function digestFilename(generatedAt: string, extension: 'json' | 'md') {
  const timestamp = new Date(generatedAt).toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-')
  return `digest-${timestamp}.${extension}`
}

export function downloadDigest(content: string, filename: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export const digestLabels = {
  category: categoryLabels,
  priority: priorityLabels,
  status: statusLabels,
  stage: stageLabels,
  confirmationSource: confirmationSourceLabels,
} as const
