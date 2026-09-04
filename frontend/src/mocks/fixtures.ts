import type {
  AnalysisVersion,
  LifecycleEvent,
  Publication,
  PublicationDetail,
  PublicationList,
  RegulatoryCase,
  RegulatoryCaseDetail,
  Source,
} from '../shared/api/types'

const defaultCriteria = {
  K1: 1,
  K2: 1,
  K3: 1,
  K4: 1,
  K5: 1,
  K6: 1,
  H1: false,
  H2: false,
  H3: false,
  H4: false,
} as const

const publication = (
  value: Omit<Publication, 'collected_at' | 'content_hash' | 'is_demo'>,
  hashDigit: string,
) =>
  ({
    ...value,
    collected_at: value.published_at,
    content_hash: `sha256:${hashDigit.repeat(64)}`,
    is_demo: true,
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
    latest_analysis_id: 'analysis-001',
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

export const publicationDetails = [
  {
    publication: publication001,
    latest_analysis: analysis(
      {
        id: 'analysis-001',
        publication_id: 'pub-001',
        summary:
          'Опубликован демонстрационный проект требований. Документ находится на стадии общественного обсуждения. Специалисту нужно проверить применимость требований и срок подачи замечаний.',
        category: 'regulation',
        proposed_priority: 'high',
        score: 10,
        uncertainty: 0.12,
        needs_review: true,
      },
      publication001,
    ),
    latest_decision: null,
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
        score: 6,
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
        score: 5,
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
        score: 7,
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
        score: 8,
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

const regulatoryCase = {
  id: 'case-001',
  title: 'Демонстрационные требования к обработке данных',
  registration_number: 'DEMO-2026-001',
  current_stage: 'draft',
  responsible_user_id: 'user-gr-001',
  related_publication_ids: ['pub-001'],
  created_at: '2026-09-01T08:10:00Z',
  updated_at: '2026-09-01T08:10:00Z',
} satisfies RegulatoryCase

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
