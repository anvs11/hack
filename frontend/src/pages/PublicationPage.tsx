import {
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, api } from '../shared/api/client'
import type {
  AnalysisVersion,
  Category,
  Priority,
  Publication,
  PublicationDetail,
  PublicationHistory,
  PublicationPatch,
  RegulatoryCase,
  Source,
  SpecialistDecision,
  SpecialistDecisionCreate,
} from '../shared/api/types'
import { formatCategory, formatDate, formatPriority } from '../shared/format'
import { PageState } from '../shared/PageState'
import { RevealText } from '../shared/RevealText'
import { getCurrentActorId } from '../shared/telegram/adapter'

const categories: Category[] = [
  'regulation',
  'reputation',
  'competitor',
  'trend',
  'unknown',
]
const priorities: Priority[] = ['critical', 'high', 'medium', 'low', 'unknown']
const importanceCriteria = [
  {
    key: 'business_relevance',
    label: 'Релевантность бизнесу',
    description: 'Насколько событие прямо влияет на компанию, продукты или клиентов.',
  },
  {
    key: 'event_maturity',
    label: 'Зрелость события',
    description: 'От неподтверждённого сигнала до принятого решения или случившегося события.',
  },
  {
    key: 'financial_impact',
    label: 'Финансовое влияние',
    description: 'Возможные расходы, потери, экономия или новая выручка.',
  },
  {
    key: 'implementation_effort',
    label: 'Сложность изменений',
    description: 'Масштаб изменений в продукте, процессах и работе команды.',
  },
  {
    key: 'risk_severity',
    label: 'Тяжесть риска',
    description: 'Юридические, репутационные и операционные последствия.',
  },
  {
    key: 'action_urgency',
    label: 'Срочность реакции',
    description: 'Как быстро нужно проверить сигнал и принять решение.',
  },
] as const
const hardSignals = [
  {
    key: 'state_support_or_accreditation_change',
    label: 'Господдержка или аккредитация',
    description: 'Меняются льготы, меры господдержки или условия ИТ-аккредитации.',
  },
  {
    key: 'service_or_legal_blocking_risk',
    label: 'Блокирующий правовой риск',
    description: 'Есть риск запрета, блокировки сервиса или уголовной ответственности.',
  },
  {
    key: 'strategic_technology_status',
    label: 'Стратегический статус технологии',
    description: 'ИИ, данные, ЦОД или ПО получают стратегически значимый статус.',
  },
  {
    key: 'binding_legal_precedent',
    label: 'Обязательный прецедент',
    description: 'Решение суда или регулятора прямо применимо к бизнесу.',
  },
] as const

type PageData = {
  detail: PublicationDetail
  history: PublicationHistory
  sources: Source[]
}

type LoadState =
  | { status: 'loading'; data: null; error: null }
  | { status: 'success'; data: PageData; error: null }
  | { status: 'error'; data: null; error: Error }

export function PublicationPage() {
  const { id = '' } = useParams()
  const [state, setState] = useState<LoadState>({
    status: 'loading',
    data: null,
    error: null,
  })
  const [selectedAnalysisId, setSelectedAnalysisId] = useState('')
  const [actionStatus, setActionStatus] = useState('')
  const [analysisBusy, setAnalysisBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading', data: null, error: null })
    setSelectedAnalysisId('')
    setActionStatus('')

    Promise.all([
      api.getPublication(id, controller.signal),
      api.getPublicationHistory(id, controller.signal),
      api.listSources(controller.signal),
    ]).then(
      ([detail, history, sources]) => {
        setState({
          status: 'success',
          data: { detail, history, sources },
          error: null,
        })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            status: 'error',
            data: null,
            error: error instanceof Error ? error : new Error('Неизвестная ошибка'),
          })
        }
      },
    )

    return () => controller.abort()
  }, [id])

  if (state.status === 'loading') {
    return <PageState kind="loading" title="Открываем публикацию" message={`ID: ${id}`} />
  }

  if (state.status === 'error') {
    return <PageState kind="error" title="Публикация не загрузилась" message={state.error.message} />
  }

  const { detail, history, sources } = state.data
  const { publication, latest_decision: latestDecision } = detail
  const latestAnalysis = history.analyses.at(-1) ?? detail.latest_analysis
  const selectedAnalysis = history.analyses.find(
    (item) => item.id === selectedAnalysisId,
  ) ?? latestAnalysis
  const source = sources.find((item) => item.id === publication.source_id)

  async function refreshAfterDecision(_decision: SpecialistDecision) {
    const [nextDetail, nextHistory] = await Promise.all([
      api.getPublication(id),
      api.getPublicationHistory(id),
    ])
    setState({
      status: 'success',
      data: { detail: nextDetail, history: nextHistory, sources },
      error: null,
    })
    setActionStatus('Решение специалиста сохранено в истории.')
  }

  async function refreshAfterMetadata(message: string) {
    const [nextDetail, nextHistory] = await Promise.all([
      api.getPublication(id),
      api.getPublicationHistory(id),
    ])
    setState({
      status: 'success',
      data: { detail: nextDetail, history: nextHistory, sources },
      error: null,
    })
    setActionStatus(message)
  }

  async function createAnalysis() {
    setAnalysisBusy(true)
    setActionStatus('')
    try {
      const analysis = await api.createPublicationAnalysis(publication.id, {
        analyzer: publication.is_demo ? 'replay' : 'live_llm',
      })
      const [nextDetail, nextHistory] = await Promise.all([
        api.getPublication(id),
        api.getPublicationHistory(id),
      ])
      setState({
        status: 'success',
        data: { detail: nextDetail, history: nextHistory, sources },
        error: null,
      })
      setSelectedAnalysisId(analysis.id)
      setActionStatus(`AI-анализ v${analysis.version} сохранён в истории.`)
    } catch (error) {
      if (error instanceof ApiError && error.code === 'analyzer_unavailable') {
        setActionStatus(
          'AI-анализ пока недоступен: на сервере не подключён быстрый inference. ' +
          'Публикация сохранена, данные не потеряны.',
        )
      } else {
        setActionStatus(
          error instanceof Error
            ? `AI-анализ не создан: ${error.message}`
            : 'AI-анализ не создан.',
        )
      }
    } finally {
      setAnalysisBusy(false)
    }
  }

  return (
    <article className="detail-page publication-workspace">
      <Link className="back-link" to="/feed"><span aria-hidden="true">←</span> Вернуться в ленту</Link>
      <header className="detail-heading">
        <div className="card-meta">
          <span>{source?.name ?? publication.source_id}</span>
          <span>{formatDate(publication.published_at)}</span>
        </div>
        <RevealText lines={[publication.title]} />
        <a className="source-link" href={publication.original_url} target="_blank" rel="noreferrer">
          Открыть первоисточник ↗
        </a>
        {publication.tags.length > 0 && (
          <div className="tag-row">
            {publication.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
          </div>
        )}
      </header>

      {actionStatus && <p className="action-message" role="status">{actionStatus}</p>}

      <PublicationMetadataEditor
        key={publication.latest_revision_id ?? publication.id}
        publication={publication}
        onSaved={refreshAfterMetadata}
      />

      <section className="analysis-launch" aria-label="Запуск AI-анализа">
        <div>
          <p className="eyebrow">Новая неизменяемая версия</p>
          <p>Исходная публикация и прошлые результаты останутся в истории.</p>
        </div>
        <button
          className="primary-action"
          disabled={analysisBusy}
          onClick={createAnalysis}
          type="button"
        >
          {analysisBusy
            ? 'Анализируем…'
            : latestAnalysis ? 'Повторить AI-анализ' : 'Запустить AI-анализ'}
        </button>
      </section>

      <div className="detail-grid">
        <section className="content-panel">
          <div className="panel-index" aria-hidden="true">01</div>
          <p className="eyebrow">Исходный материал</p>
          <h2>Содержание</h2>
          <p className="publication-content">{publication.content}</p>
        </section>

        {selectedAnalysis ? (
          <AnalysisDetails analysis={selectedAnalysis} />
        ) : (
          <PageState kind="empty" title="AI-анализа нет" message="Для этой публикации ещё нет версии анализа." />
        )}
      </div>

      {latestDecision && <LatestDecision decision={latestDecision} />}

      <section className="history-section" aria-labelledby="history-heading">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Аудит версий</p>
            <h2 id="history-heading">История анализа и решений</h2>
          </div>
          <span className="history-count">
            {history.revisions.length} правок · {history.analyses.length} AI · {history.decisions.length} решений
          </span>
        </div>
        <History
          history={history}
          selectedAnalysisId={selectedAnalysis?.id ?? ''}
          onSelectAnalysis={(analysisId) => {
            setSelectedAnalysisId(analysisId)
            setActionStatus('')
          }}
        />
      </section>

      <section className="specialist-section" aria-labelledby="decision-heading">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Решение человека</p>
            <h2 id="decision-heading">Подтвердить или скорректировать</h2>
          </div>
          <CaseLinkDialog publicationId={publication.id} />
        </div>
        {selectedAnalysis ? (
          <DecisionPanel
            key={`${selectedAnalysis.id}-${latestDecision?.id ?? 'none'}`}
            publicationId={publication.id}
            analysis={selectedAnalysis}
            onSaved={refreshAfterDecision}
          />
        ) : (
          <p className="inline-empty" role="status">
            Сохранить решение нельзя: сначала нужна версия AI-анализа.
          </p>
        )}
      </section>
    </article>
  )
}

function AnalysisDetails({ analysis }: { analysis: AnalysisVersion }) {
  return (
    <section className="analysis-panel full-analysis" aria-labelledby="analysis-heading">
      <div className="panel-index" aria-hidden="true">02</div>
      <p className="eyebrow">AI-анализ · v{analysis.version}</p>
      <h2 id="analysis-heading">Выбранная версия</h2>
      <dl className="analysis-meta">
        <div><dt>Анализатор</dt><dd>{analysis.analyzer}</dd></div>
        <div><dt>Модель</dt><dd>{analysis.model}</dd></div>
        <div><dt>Prompt</dt><dd>{analysis.prompt_version}</dd></div>
        <div><dt>Создано</dt><dd>{formatDate(analysis.created_at)}</dd></div>
      </dl>

      <div className="analysis-copy-block">
        <h3>AI-саммари</h3>
        <p>{analysis.summary}</p>
      </div>
      <div className="tag-row analysis-tags">
        <span className="tag">Категория · {formatCategory(analysis.category)}</span>
        <span className={`priority priority-${analysis.proposed_priority}`}>
          AI-приоритет · {formatPriority(analysis.proposed_priority)}
        </span>
      </div>
      <dl className="analysis-stats">
        <div>
          <dt>Индекс важности</dt>
          <dd>{analysis.importance_score === null
            ? 'Не рассчитан'
            : `${analysis.importance_score} из 18`}</dd>
        </div>
        <div><dt>Неопределённость</dt><dd>{Math.round(analysis.uncertainty * 100)}%</dd></div>
        <div><dt>Проверка</dt><dd>{analysis.needs_review ? 'Нужна' : 'Не нужна'}</dd></div>
      </dl>

      <div className="analysis-columns">
        <AnalysisList title="Факты" values={analysis.facts} empty="Факты не извлечены" />
        <section>
          <h3>Сущности</h3>
          {analysis.entities.length ? (
            <ul className="analysis-list entity-list">
              {analysis.entities.map((entity, index) => (
                <li key={`${entity.type}-${entity.value}-${index}`}>
                  <span>{entity.type}</span><strong>{entity.value}</strong>
                </li>
              ))}
            </ul>
          ) : <p className="explicit-empty">Сущности не извлечены</p>}
        </section>
      </div>

      <section className="criteria-section">
        <h3>Из чего складывается важность</h3>
        <p className="criteria-hint">
          Каждый критерий оценивается от 0 до 3. Сумма определяет AI-приоритет,
          а окончательное решение остаётся за специалистом.
        </p>
        <dl className="criteria-grid">
          {importanceCriteria.map(({ key, label, description }) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{analysis.criteria[key] === null
                ? 'Нет данных'
                : `${analysis.criteria[key]} / 3`}</dd>
              <p>{description}</p>
            </div>
          ))}
        </dl>
        <h3>Сигналы обязательной проверки</h3>
        <dl className="flags-grid">
          {hardSignals.map(({ key, label, description }) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{analysis.criteria[key] ? 'Есть' : 'Нет'}</dd>
              <p>{description}</p>
            </div>
          ))}
        </dl>
      </section>

      <section className="evidence-section">
        <h3>Доказательства</h3>
        {analysis.evidence.length ? (
          <ol className="evidence-list">
            {analysis.evidence.map((evidence, index) => (
              <li key={`${evidence.claim}-${index}`}>
                <strong>{evidence.claim}</strong>
                <blockquote>«{evidence.quote}»</blockquote>
              </li>
            ))}
          </ol>
        ) : <p className="explicit-empty">Доказательства не извлечены</p>}
      </section>
    </section>
  )
}

function AnalysisList({ title, values, empty }: { title: string; values: string[]; empty: string }) {
  return (
    <section>
      <h3>{title}</h3>
      {values.length ? (
        <ul className="analysis-list">{values.map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}</ul>
      ) : <p className="explicit-empty">{empty}</p>}
    </section>
  )
}

function LatestDecision({ decision }: { decision: SpecialistDecision }) {
  return (
    <section className="latest-decision" aria-labelledby="latest-decision-heading">
      <div>
        <p className="eyebrow">Финальное решение специалиста · v{decision.version}</p>
        <h2 id="latest-decision-heading">{formatDecisionStatus(decision.status)}</h2>
        <p>{decision.final_summary ?? 'Саммари AI подтверждено без исправлений.'}</p>
      </div>
      <dl className="decision-summary">
        <div><dt>Категория</dt><dd>{formatCategory(decision.final_category)}</dd></div>
        <div><dt>Финальный приоритет</dt><dd>{formatPriority(decision.final_priority)}</dd></div>
        <div><dt>Автор</dt><dd>{decision.author_id}</dd></div>
        <div><dt>Дата</dt><dd>{formatDate(decision.created_at)}</dd></div>
        <div className="decision-comment"><dt>Комментарий</dt><dd>{decision.comment ?? 'Нет комментария'}</dd></div>
      </dl>
    </section>
  )
}

function History({
  history,
  selectedAnalysisId,
  onSelectAnalysis,
}: {
  history: PublicationHistory
  selectedAnalysisId: string
  onSelectAnalysis: (analysisId: string) => void
}) {
  return (
    <div className="history-grid">
      <section aria-labelledby="analysis-history-heading">
        <h3 id="analysis-history-heading">Версии AI-анализа</h3>
        {history.analyses.length ? (
          <ol className="version-list">
            {history.analyses.map((analysis) => (
              <li key={analysis.id}>
                <button
                  type="button"
                  className="version-button"
                  aria-pressed={analysis.id === selectedAnalysisId}
                  onClick={() => onSelectAnalysis(analysis.id)}
                >
                  <span>v{analysis.version} · {formatDate(analysis.created_at)}</span>
                  <strong>{analysis.analyzer} / {analysis.model}</strong>
                  <small>{analysis.summary}</small>
                  <small>
                    {formatCategory(analysis.category)} · AI-{formatPriority(analysis.proposed_priority)}
                  </small>
                </button>
              </li>
            ))}
          </ol>
        ) : <p className="inline-empty" role="status">Версий анализа нет.</p>}
      </section>
      <section aria-labelledby="decision-history-heading">
        <h3 id="decision-history-heading">Решения специалиста</h3>
        {history.decisions.length ? (
          <ol className="decision-history-list">
            {history.decisions.map((decision) => (
              <li key={decision.id}>
                <span>v{decision.version} · {formatDate(decision.created_at)}</span>
                <strong>{formatDecisionStatus(decision.status)}</strong>
                <p>Автор: {decision.author_id}</p>
                <p>Саммари: {decision.final_summary ?? 'без исправлений'}</p>
                <p>Категория: {formatCategory(decision.final_category)}</p>
                <p>Финальный приоритет: {formatPriority(decision.final_priority)}</p>
                <p>Комментарий: {decision.comment ?? 'нет'}</p>
              </li>
            ))}
          </ol>
        ) : <p className="inline-empty" role="status">Решений специалиста ещё нет.</p>}
      </section>
      <section aria-labelledby="revision-history-heading">
        <h3 id="revision-history-heading">Правки карточки</h3>
        {history.revisions.length ? (
          <ol className="decision-history-list">
            {history.revisions.map((revision) => (
              <li key={revision.id}>
                <span>v{revision.version} · {formatDate(revision.created_at)}</span>
                <strong>{revision.title}</strong>
                <p>Автор: {revision.author_id}</p>
                <p>Теги: {revision.tags.join(', ') || 'нет'}</p>
                <p>В ленте: {revision.is_hidden ? 'скрыта' : 'видна'}</p>
              </li>
            ))}
          </ol>
        ) : <p className="inline-empty">Правок карточки ещё нет.</p>}
      </section>
    </div>
  )
}

function PublicationMetadataEditor({
  publication,
  onSaved,
}: {
  publication: Publication
  onSaved: (message: string) => Promise<void>
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [title, setTitle] = useState(publication.title)
  const [tags, setTags] = useState(publication.tags.join(', '))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function save(patch: Omit<PublicationPatch, 'author_id'>, message: string) {
    if (isSubmitting) return
    setIsSubmitting(true)
    setError('')
    try {
      await api.updatePublication(publication.id, {
        ...patch,
        author_id: getCurrentActorId(),
      })
      setIsEditing(false)
      await onSaved(message)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось изменить публикацию')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedTags = [...new Set(
      tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    )]
    await save(
      { title: title.trim(), tags: normalizedTags },
      'Заголовок и теги сохранены новой версией.',
    )
  }

  return (
    <section className="metadata-editor" aria-labelledby="metadata-editor-heading">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Управление карточкой</p>
          <h2 id="metadata-editor-heading">Метаданные и видимость</h2>
        </div>
        <div className="dialog-actions">
          <button className="secondary-action" type="button" onClick={() => setIsEditing((value) => !value)}>
            {isEditing ? 'Отменить правку' : 'Изменить заголовок и теги'}
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={isSubmitting}
            onClick={() => save(
              { is_hidden: !publication.is_hidden },
              publication.is_hidden ? 'Публикация возвращена в ленту.' : 'Публикация скрыта из ленты.',
            )}
          >
            {publication.is_hidden ? 'Вернуть в ленту' : 'Скрыть из ленты'}
          </button>
        </div>
      </div>
      {isEditing && (
        <form className="decision-form" onSubmit={submit}>
          <label className="form-field form-field-wide">
            <span>Заголовок</span>
            <input value={title} required onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="form-field form-field-wide">
            <span>Теги через запятую</span>
            <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="НПА, ИТ, гранты" />
          </label>
          <div className="decision-actions form-field-wide">
            <div>
              <strong>Исходный материал не изменится</strong>
              <span>Правка попадёт в append-only историю.</span>
            </div>
            <button type="submit" disabled={isSubmitting || !title.trim()}>
              {isSubmitting ? 'Сохраняем…' : 'Сохранить правку'}
            </button>
          </div>
        </form>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  )
}

function DecisionPanel({
  publicationId,
  analysis,
  onSaved,
}: {
  publicationId: string
  analysis: AnalysisVersion
  onSaved: (decision: SpecialistDecision) => Promise<void>
}) {
  const [summary, setSummary] = useState(analysis.summary)
  const [category, setCategory] = useState<Category>(analysis.category)
  const [priority, setPriority] = useState<Priority>(analysis.proposed_priority)
  const [comment, setComment] = useState('')
  const [confirmUnknown, setConfirmUnknown] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const submitGuard = useRef(false)

  const isCorrected = summary !== analysis.summary ||
    category !== analysis.category ||
    priority !== analysis.proposed_priority
  const unknownNeedsConfirmation = priority === 'unknown' && !confirmUnknown

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitGuard.current || unknownNeedsConfirmation) return
    submitGuard.current = true
    setIsSubmitting(true)
    setError('')

    const payload: SpecialistDecisionCreate = {
      analysis_id: analysis.id,
      status: isCorrected ? 'corrected' : 'confirmed',
      final_summary: summary === analysis.summary ? null : summary,
      final_category: category,
      final_priority: priority,
      comment: comment.trim() || null,
      author_id: getCurrentActorId(),
    }

    try {
      const decision = await api.createSpecialistDecision(publicationId, payload)
      await onSaved(decision)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить решение')
    } finally {
      submitGuard.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <form className="decision-form" onSubmit={submit}>
      <div className="form-context">
        <span>Analysis ID</span>
        <strong>{analysis.id} · v{analysis.version}</strong>
        <span>Автор действия</span>
        <strong>{getCurrentActorId()}</strong>
      </div>
      <label className="form-field form-field-wide">
        <span>Итоговое саммари</span>
        <textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={7} />
      </label>
      <label className="form-field">
        <span>Итоговая категория</span>
        <select value={category} onChange={(event) => setCategory(event.target.value as Category)}>
          {categories.map((value) => <option key={value} value={value}>{formatCategory(value)}</option>)}
        </select>
      </label>
      <label className="form-field">
        <span>Финальный приоритет</span>
        <select
          value={priority}
          onChange={(event) => {
            setPriority(event.target.value as Priority)
            setConfirmUnknown(false)
          }}
        >
          {priorities.map((value) => <option key={value} value={value}>{formatPriority(value)}</option>)}
        </select>
      </label>
      {priority === 'unknown' && (
        <label className="unknown-confirm form-field-wide">
          <input
            type="checkbox"
            checked={confirmUnknown}
            onChange={(event) => setConfirmUnknown(event.target.checked)}
          />
          <span>Я явно подтверждаю финальный приоритет «Неизвестно».</span>
        </label>
      )}
      <label className="form-field form-field-wide">
        <span>Комментарий · необязательно</span>
        <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={4} />
      </label>
      <div className="decision-actions form-field-wide">
        <div>
          <strong>{isCorrected ? 'Будет сохранено как исправление' : 'Будет сохранено как подтверждение'}</strong>
          <span>AI-версия останется неизменной.</span>
        </div>
        <button type="submit" disabled={isSubmitting || unknownNeedsConfirmation}>
          {isSubmitting ? 'Сохраняем…' : 'Сохранить решение'}
        </button>
      </div>
      {error && <p className="form-error form-field-wide" role="alert">{error}</p>}
    </form>
  )
}

function CaseLinkDialog({ publicationId }: { publicationId: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const [cases, setCases] = useState<RegulatoryCase[] | null>(null)
  const [selectedCaseId, setSelectedCaseId] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [isLinking, setIsLinking] = useState(false)
  const openerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!isOpen) return
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDialog()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ))
      if (!focusable.length) return

      const first = focusable[0]
      const last = focusable.at(-1)!
      const focusIsOutside = !dialogRef.current.contains(document.activeElement)
      if (event.shiftKey && (document.activeElement === first || focusIsOutside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || focusIsOutside)) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen])

  async function openDialog() {
    setIsOpen(true)
    setCases(null)
    setError('')
    setStatus('')
    try {
      const nextCases = await api.listRegulatoryCases()
      setCases(nextCases)
      setSelectedCaseId(nextCases[0]?.id ?? '')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить кейсы НПА')
    }
  }

  function closeDialog() {
    setIsOpen(false)
    window.setTimeout(() => openerRef.current?.focus(), 0)
  }

  async function linkCase() {
    if (!selectedCaseId || isLinking) return
    setIsLinking(true)
    setError('')
    setStatus('')
    try {
      await api.linkPublicationToCase(selectedCaseId, publicationId)
      const nextCases = await api.listRegulatoryCases()
      setCases(nextCases)
      setStatus('Публикация успешно привязана к НПА.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось привязать публикацию')
    } finally {
      setIsLinking(false)
      window.setTimeout(() => confirmRef.current?.focus(), 0)
    }
  }

  return (
    <>
      <button ref={openerRef} className="secondary-action" type="button" onClick={openDialog}>
        Привязать к НПА
      </button>
      {isOpen && (
        <div className="dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeDialog()
        }}>
          <section
            ref={dialogRef}
            className="case-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="case-dialog-title"
          >
            <div className="dialog-heading">
              <div>
                <p className="eyebrow">Существующие кейсы</p>
                <h2 id="case-dialog-title">Привязать публикацию к НПА</h2>
              </div>
              <button ref={closeRef} type="button" className="dialog-close" onClick={closeDialog} aria-label="Закрыть диалог">×</button>
            </div>
            {cases === null && !error && <p className="inline-empty" role="status">Загружаем кейсы НПА…</p>}
            {error && <p className="form-error" role="alert">{error}</p>}
            {cases?.length === 0 && <p className="inline-empty" role="status">Существующих кейсов НПА пока нет.</p>}
            {cases && cases.length > 0 && (
              <fieldset className="case-options">
                <legend>Выберите кейс НПА</legend>
                {cases.map((regulatoryCase) => (
                  <label key={regulatoryCase.id}>
                    <input
                      type="radio"
                      name="regulatory-case"
                      value={regulatoryCase.id}
                      checked={selectedCaseId === regulatoryCase.id}
                      onChange={() => setSelectedCaseId(regulatoryCase.id)}
                    />
                    <span>
                      <strong>{regulatoryCase.title}</strong>
                      <small>{regulatoryCase.registration_number} · {regulatoryCase.current_stage}</small>
                      {regulatoryCase.related_publication_ids.includes(publicationId) && <small>Уже привязана</small>}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            {status && <p className="action-message" role="status">{status}</p>}
            <div className="dialog-actions">
              <button type="button" className="secondary-action" onClick={closeDialog}>Отмена</button>
              <button ref={confirmRef} type="button" className="primary-action" disabled={!selectedCaseId || isLinking} onClick={linkCase}>
                {isLinking ? 'Привязываем…' : 'Подтвердить привязку'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}

function formatDecisionStatus(status: SpecialistDecision['status']) {
  return {
    confirmed: 'Подтверждено',
    corrected: 'Скорректировано',
    rejected: 'Отклонено',
  }[status]
}
