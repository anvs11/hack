import type {
  AnalysisVersion,
  LifecycleEvent,
  Publication,
  PublicationDetail,
  PublicationList,
  PublicationHistory,
  RegulatoryCase,
  RegulatoryCaseDetail,
  Source,
  SpecialistDecision,
} from '../shared/api/types'

const defaultCriteria = {
  business_relevance: 1,
  event_maturity: 1,
  financial_impact: 1,
  implementation_effort: 1,
  risk_severity: 1,
  action_urgency: 1,
  state_support_or_accreditation_change: false,
  service_or_legal_blocking_risk: false,
  strategic_technology_status: false,
  binding_legal_precedent: false,
} as const

const publication = (
  value: Omit<
    Publication,
    | 'collected_at'
    | 'content_hash'
    | 'is_demo'
    | 'latest_revision_id'
    | 'tags'
    | 'is_hidden'
    | 'is_manual'
    | 'updated_at'
  >,
  hashDigit: string,
) =>
  ({
    ...value,
    collected_at: value.published_at,
    content_hash: `sha256:${hashDigit.repeat(64)}`,
    is_demo: true,
    latest_revision_id: null,
    tags: [],
    is_hidden: false,
    is_manual: false,
    updated_at: value.published_at,
  }) satisfies Publication

const analysis = (
  value: Omit<
    AnalysisVersion,
    | 'version'
    | 'analyzer'
    | 'model'
    | 'prompt_version'
    | 'input_hash'
    | 'facts'
    | 'entities'
    | 'criteria'
    | 'evidence'
    | 'created_at'
  >,
  card: Publication,
) =>
  ({
    ...value,
    version: 1,
    analyzer: 'replay',
    model: 'demo-replay-v1',
    prompt_version: 'analysis-v1',
    input_hash: card.content_hash,
    facts: [],
    entities: [],
    criteria: defaultCriteria,
    evidence: [],
    created_at: card.collected_at,
  }) satisfies AnalysisVersion

const publication001 = publication(
  {
    id: 'pub-001',
    source_id: 'source-regulation',
    external_id: 'demo-reg-001',
    title: 'Проект требований к обработке данных вынесен на обсуждение',
    original_url: 'https://example.org/regulation/demo-reg-001',
    published_at: '2026-09-01T07:30:00Z',
    content:
      'Демонстрационный материал: регулятор опубликовал проект требований и установил срок общественного обсуждения.',
    latest_analysis_id: 'analysis-001-v2',
  },
  '1',
)

const publication004 = publication(
  {
    id: 'pub-004',
    source_id: 'source-media-rss-2',
    external_id: 'demo-tech-004',
    title: 'Рынок облачных сервисов показал рост',
    original_url: 'https://example.org/technology/demo-tech-004',
    published_at: '2026-09-01T09:00:00Z',
    content:
      'Демонстрационная новость: аналитики сообщили о росте спроса на отечественные облачные сервисы.',
    latest_analysis_id: 'analysis-004',
  },
  '4',
)

const publication005 = publication(
  {
    id: 'pub-005',
    source_id: 'source-telegram-archive',
    external_id: 'demo-tg-005',
    title: 'В отраслевом канале обсуждают возможное изменение требований',
    original_url: 'https://example.org/telegram/demo-tg-005',
    published_at: '2026-09-01T09:15:00Z',
    content:
      'Демонстрационный архив: автор канала сообщает о возможном изменении требований без первоисточника.',
    latest_analysis_id: 'analysis-005',
  },
  '5',
)

const publication008 = publication(
  {
    id: 'pub-008',
    source_id: 'source-media-rss-1',
    external_id: 'demo-media-008',
    title: 'Компания опровергла сообщение о сбое сервиса',
    original_url: 'https://example.org/business/demo-media-008',
    published_at: '2026-09-01T11:00:00Z',
    content:
      'Демонстрационная новость: пресс-служба сообщила о штатной работе сервиса.',
    latest_analysis_id: 'analysis-008',
  },
  '8',
)

const publication009 = publication(
  {
    id: 'pub-009',
    source_id: 'source-media-rss-2',
    external_id: 'demo-tech-009',
    title: 'Конкурент представил платформу аналитики',
    original_url: 'https://example.org/technology/demo-tech-009',
    published_at: '2026-09-01T11:30:00Z',
    content:
      'Демонстрационная новость: конкурент представил платформу мониторинга открытых источников.',
    latest_analysis_id: 'analysis-009',
  },
  '9',
)

export const analysis001v1 = analysis(
  {
    id: 'analysis-001',
    publication_id: 'pub-001',
    summary:
      'Опубликован демонстрационный проект требований. Документ находится на стадии общественного обсуждения.',
    category: 'regulation',
    proposed_priority: 'medium',
    importance_score: 6,
    uncertainty: 0.24,
    needs_review: true,
  },
  publication001,
)

export const analysis001v2 = {
  ...analysis001v1,
  id: 'analysis-001-v2',
  version: 2,
  model: 'demo-replay-v2',
  prompt_version: 'analysis-v2',
  summary:
    'Опубликован демонстрационный проект требований. Документ находится на стадии общественного обсуждения. Специалисту нужно проверить применимость требований и срок подачи замечаний.',
  facts: [
    'Опубликован проект требований',
    'Указан период общественного обсуждения',
  ],
  entities: [
    { type: 'document', value: 'проект требований' },
    { type: 'topic', value: 'обработка данных' },
  ],
  category: 'regulation' as const,
  proposed_priority: 'high' as const,
  criteria: {
    business_relevance: 3,
    event_maturity: 2,
    financial_impact: 3,
    implementation_effort: 1,
    risk_severity: 1,
    action_urgency: 0,
    state_support_or_accreditation_change: false,
    service_or_legal_blocking_risk: false,
    strategic_technology_status: false,
    binding_legal_precedent: false,
  },
  importance_score: 10,
  evidence: [
    {
      claim: 'Документ находится на обсуждении',
      quote: 'установил срок общественного обсуждения',
    },
  ],
  uncertainty: 0.12,
  needs_review: true,
  created_at: '2026-09-01T12:05:00Z',
} satisfies AnalysisVersion

export const existingDecision = {
  id: 'decision-001',
  publication_id: 'pub-001',
  analysis_id: 'analysis-001',
  version: 1,
  status: 'corrected',
  final_summary: 'Проект требований опубликован для обсуждения.',
  final_category: 'regulation',
  final_priority: 'high',
  comment: 'Проверено по первоисточнику.',
  author_id: 'user-gr-001',
  created_at: '2026-09-01T12:20:00Z',
} satisfies SpecialistDecision

export const publicationHistory = {
  publication_id: 'pub-001',
  revisions: [],
  analyses: [analysis001v1, analysis001v2],
  decisions: [existingDecision],
} satisfies PublicationHistory

export const publicationDetails = [
  {
    publication: publication001,
    latest_analysis: analysis001v2,
    latest_decision: existingDecision,
  },
  {
    publication: publication004,
    latest_analysis: analysis(
      {
        id: 'analysis-004',
        publication_id: 'pub-004',
        summary:
          'Заявлен рост спроса на отечественные облачные сервисы. Наблюдение относится к корпоративному сегменту.',
        category: 'trend',
        proposed_priority: 'medium',
        importance_score: 6,
        uncertainty: 0.18,
        needs_review: false,
      },
      publication004,
    ),
    latest_decision: null,
  },
  {
    publication: publication005,
    latest_analysis: analysis(
      {
        id: 'analysis-005',
        publication_id: 'pub-005',
        summary:
          'Telegram-архив содержит неподтверждённое сообщение. Материал нельзя использовать как подтверждение lifecycle.',
        category: 'regulation',
        proposed_priority: 'medium',
        importance_score: 5,
        uncertainty: 0.72,
        needs_review: true,
      },
      publication005,
    ),
    latest_decision: null,
  },
  {
    publication: publication008,
    latest_analysis: analysis(
      {
        id: 'analysis-008',
        publication_id: 'pub-008',
        summary:
          'Пресс-служба опровергла сообщение о массовом сбое. Материал относится к репутационному контуру.',
        category: 'reputation',
        proposed_priority: 'medium',
        importance_score: 7,
        uncertainty: 0.3,
        needs_review: true,
      },
      publication008,
    ),
    latest_decision: null,
  },
  {
    publication: publication009,
    latest_analysis: analysis(
      {
        id: 'analysis-009',
        publication_id: 'pub-009',
        summary:
          'Конкурент представил платформу мониторинга открытых источников для корпоративного рынка.',
        category: 'competitor',
        proposed_priority: 'medium',
        importance_score: 8,
        uncertainty: 0.1,
        needs_review: false,
      },
      publication009,
    ),
    latest_decision: null,
  },
] satisfies PublicationDetail[]

export const publicationList = {
  items: publicationDetails,
  total: publicationDetails.length,
  limit: 20,
  offset: 0,
} satisfies PublicationList

export const regulatoryCase = {
  id: 'case-001',
  title: 'Демонстрационные требования к обработке данных',
  registration_number: 'DEMO-2026-001',
  current_stage: 'draft',
  responsible_user_id: 'user-gr-001',
  related_publication_ids: ['pub-001', 'pub-005'],
  created_at: '2026-09-01T08:10:00Z',
  updated_at: '2026-09-01T08:10:00Z',
} satisfies RegulatoryCase

export const regulatoryCases = [regulatoryCase] satisfies RegulatoryCase[]

const lifecycleEvent = {
  id: 'event-001',
  regulatory_case_id: 'case-001',
  stage: 'draft',
  occurred_at: '2026-09-01T07:30:00Z',
  confirmation_url: 'https://example.org/regulation/demo-reg-001',
  confirmation_source_type: 'regulator',
  comment: 'Проект опубликован для общественного обсуждения.',
  author_id: 'user-gr-001',
  created_at: '2026-09-01T08:10:00Z',
} satisfies LifecycleEvent

export const regulatoryCaseDetail = {
  regulatory_case: regulatoryCase,
  timeline: [lifecycleEvent],
} satisfies RegulatoryCaseDetail

export const sources = [
  {
    id: 'source-regulation',
    name: 'Портал проектов НПА (demo)',
    type: 'regulator',
    url: 'https://regulation.gov.ru/',
    enabled: true,
    last_checked_at: '2026-09-01T07:35:00Z',
    is_demo: true,
    last_success_at: '2026-09-01T07:35:00Z',
    last_error: null,
  },
  {
    id: 'source-duma',
    name: 'Система обеспечения законодательной деятельности (demo)',
    type: 'regulator',
    url: 'https://sozd.duma.gov.ru/',
    enabled: true,
    last_checked_at: '2026-09-01T08:05:00Z',
    is_demo: true,
    last_success_at: '2026-09-01T08:05:00Z',
    last_error: null,
  },
  {
    id: 'source-media-rss-1',
    name: 'Деловые новости — RSS fixture',
    type: 'rss',
    url: 'https://example.org/feeds/business.xml',
    enabled: true,
    last_checked_at: '2026-09-01T11:05:00Z',
    is_demo: true,
    last_success_at: '2026-09-01T11:05:00Z',
    last_error: null,
  },
  {
    id: 'source-media-rss-2',
    name: 'Технологические новости — RSS fixture',
    type: 'rss',
    url: 'https://example.org/feeds/technology.xml',
    enabled: true,
    last_checked_at: '2026-09-01T11:35:00Z',
    is_demo: true,
    last_success_at: '2026-09-01T11:35:00Z',
    last_error: null,
  },
  {
    id: 'source-telegram-archive',
    name: 'Отраслевой Telegram-архив (demo)',
    type: 'telegram_archive',
    url: 'https://example.org/telegram/archive',
    enabled: true,
    last_checked_at: '2026-09-01T09:20:00Z',
    is_demo: true,
    last_success_at: '2026-09-01T09:20:00Z',
    last_error: null,
  },
] satisfies Source[]
