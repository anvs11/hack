import {
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, api } from '../shared/api/client'
import type {
  ConfirmationSourceType,
  LifecycleEventCreate,
  LifecycleStage,
  PublicationDetail,
  RegulatoryCaseDetail,
  Source,
} from '../shared/api/types'
import { formatDate } from '../shared/format'
import { PageState } from '../shared/PageState'
import { RevealText } from '../shared/RevealText'
import { getCurrentActorId } from '../shared/telegram/adapter'

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
  regulator: 'Официальный сайт регулятора',
  official_publication: 'Официальное опубликование',
}

const allowedTransitions: Record<LifecycleStage, LifecycleStage[]> = {
  draft: ['introduced'],
  introduced: ['adopted'],
  adopted: ['published'],
  published: ['effective'],
  effective: ['amended', 'repealed'],
  amended: ['effective', 'repealed'],
  repealed: [],
}

const lifecycleStages = Object.keys(stageLabels) as LifecycleStage[]

type RelatedPublication = {
  id: string
  detail: PublicationDetail | null
}

type PageData = {
  detail: RegulatoryCaseDetail
  relatedPublications: RelatedPublication[]
  sources: Source[]
}

type LoadState =
  | { status: 'loading'; data: null; error: null }
  | { status: 'success'; data: PageData; error: null }
  | { status: 'error'; data: null; error: Error }

function currentLocalDateTime() {
  const now = new Date()
  const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return localTime.toISOString().slice(0, 16)
}

async function loadPageData(caseId: string, signal?: AbortSignal): Promise<PageData> {
  const detail = await api.getRegulatoryCase(caseId, signal)
  const publicationRequests = detail.regulatory_case.related_publication_ids.map(
    async (publicationId): Promise<RelatedPublication> => {
      try {
        return { id: publicationId, detail: await api.getPublication(publicationId, signal) }
      } catch {
        return { id: publicationId, detail: null }
      }
    },
  )
  const [relatedPublications, sources] = await Promise.all([
    Promise.all(publicationRequests),
    api.listSources(signal).catch(() => []),
  ])
  return { detail, relatedPublications, sources }
}

export function RegulatoryCasePage() {
  const { id = '' } = useParams()
  const [state, setState] = useState<LoadState>({
    status: 'loading',
    data: null,
    error: null,
  })

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading', data: null, error: null })

    loadPageData(id, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) {
          setState({ status: 'success', data, error: null })
        }
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
    return <PageState kind="loading" title="Открываем кейс НПА" message={`ID: ${id}`} />
  }

  if (state.status === 'error') {
    return <PageState kind="error" title="Кейс не загрузился" message={state.error.message} />
  }

  const { detail, relatedPublications, sources } = state.data
  const { regulatory_case: regulatoryCase, timeline } = detail

  async function refreshCase() {
    const data = await loadPageData(id)
    setState({ status: 'success', data, error: null })
  }

  return (
    <article className="regulatory-case-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Кейс НПА · {regulatoryCase.registration_number}</p>
          <RevealText lines={[regulatoryCase.title]} />
          <p className="page-description">Ответственный: {regulatoryCase.responsible_user_id}</p>
        </div>
        <div className="stage-card">
          <span className="status-dot" aria-hidden="true" />
          <span>Текущая стадия</span>
          <strong>{stageLabels[regulatoryCase.current_stage]}</strong>
        </div>
      </header>

      <section className="timeline-section" aria-labelledby="timeline-heading">
        <p className="eyebrow">Append-only history</p>
        <div className="timeline-title-row">
          <h2 id="timeline-heading">Хронология</h2>
          <span>Новые события только добавляются</span>
        </div>
        {timeline.length === 0 ? (
          <PageState kind="empty" title="Событий пока нет" message="В lifecycle ещё не добавлено ни одного события." />
        ) : (
          <ol className="timeline" aria-label="Хронология">
            {timeline.map((event, index) => (
              <li key={event.id}>
                <div className="timeline-marker" aria-hidden="true" />
                <div className="timeline-card">
                  <span className="timeline-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  <div className="card-meta">
                    <span>{formatDate(event.occurred_at)}</span>
                    <span>{confirmationSourceLabels[event.confirmation_source_type]}</span>
                  </div>
                  <h3>{stageLabels[event.stage]}</h3>
                  <dl className="timeline-details">
                    <div><dt>Комментарий</dt><dd>{event.comment ?? 'Комментарий отсутствует'}</dd></div>
                    <div><dt>Автор события</dt><dd>{event.author_id}</dd></div>
                  </dl>
                  <a href={event.confirmation_url} target="_blank" rel="noreferrer">Официальное подтверждение ↗</a>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <RelatedPublications
        publications={relatedPublications}
        sources={sources}
      />

      <section className="lifecycle-form-section" aria-labelledby="lifecycle-form-heading">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Официальное подтверждение</p>
            <h2 id="lifecycle-form-heading">Добавить официальное событие</h2>
          </div>
        </div>
        <p className="evidence-notice">
          СМИ и Telegram являются только дополнительными материалами и не подтверждают стадию НПА.
        </p>
        <LifecycleEventForm
          caseId={regulatoryCase.id}
          currentStage={regulatoryCase.current_stage}
          hasEvents={timeline.length > 0}
          responsibleUserId={regulatoryCase.responsible_user_id}
          onSaved={refreshCase}
        />
      </section>
    </article>
  )
}

function RelatedPublications({
  publications,
  sources,
}: {
  publications: RelatedPublication[]
  sources: Source[]
}) {
  return (
    <section className="related-publications-section" aria-labelledby="related-publications-heading">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Контекст кейса</p>
          <h2 id="related-publications-heading">Связанные публикации</h2>
        </div>
        <span className="history-count">{publications.length} материалов</span>
      </div>
      <p className="evidence-notice">
        Связанные публикации — дополнительные материалы. Они не изменяют стадию без отдельного официально подтверждённого события.
      </p>
      {publications.length === 0 ? (
        <PageState kind="empty" title="Связанных публикаций нет" message="К этому кейсу ещё не привязаны дополнительные материалы." />
      ) : (
        <ul className="related-publication-list">
          {publications.map(({ id, detail }) => {
            const publication = detail?.publication
            const source = sources.find((item) => item.id === publication?.source_id)
            const isTelegram = source?.type === 'telegram' || source?.type === 'telegram_archive'
            return (
              <li key={id}>
                <div>
                  <span className="related-publication-kind">
                    {isTelegram ? 'Дополнительный материал · Telegram archive' : 'Дополнительный материал'}
                  </span>
                  <h3><Link to={`/publications/${id}`}>{publication?.title ?? `Публикация ${id}`}</Link></h3>
                </div>
                <dl>
                  <div><dt>ID</dt><dd>{id}</dd></div>
                  {publication && <div><dt>Дата</dt><dd>{formatDate(publication.published_at)}</dd></div>}
                  {publication && <div><dt>Источник</dt><dd>{source?.name ?? publication.source_id}</dd></div>}
                </dl>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function LifecycleEventForm({
  caseId,
  currentStage,
  hasEvents,
  responsibleUserId,
  onSaved,
}: {
  caseId: string
  currentStage: LifecycleStage
  hasEvents: boolean
  responsibleUserId: string
  onSaved: () => Promise<void>
}) {
  const suggestedStages = allowedTransitions[currentStage]
  const availableStages = hasEvents
    ? currentStage === 'repealed'
      ? []
      : [
          ...suggestedStages,
          ...lifecycleStages.filter((stage) => !suggestedStages.includes(stage)),
        ]
    : [currentStage, ...suggestedStages]
  const firstAvailableStage = availableStages[0] ?? ''
  const [stage, setStage] = useState<LifecycleStage | ''>(firstAvailableStage)
  const [occurredAt, setOccurredAt] = useState(currentLocalDateTime)
  const [confirmationUrl, setConfirmationUrl] = useState('')
  const [confirmationSourceType, setConfirmationSourceType] = useState<ConfirmationSourceType>('regulator')
  const [comment, setComment] = useState('')
  const [authorId, setAuthorId] = useState(responsibleUserId)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const submitGuard = useRef(false)

  useEffect(() => {
    setStage(firstAvailableStage)
  }, [firstAvailableStage])

  if (availableStages.length === 0) {
    return (
      <p className="inline-empty terminal-stage" role="status">
        Стадия «Отменён» является терминальной: добавить следующее событие нельзя.
      </p>
    )
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitGuard.current || !stage) return
    submitGuard.current = true
    setIsSubmitting(true)
    setError('')
    setStatus('')

    const payload: LifecycleEventCreate = {
      stage,
      occurred_at: new Date(occurredAt).toISOString(),
      confirmation_url: confirmationUrl,
      confirmation_source_type: confirmationSourceType,
      comment: comment.trim() || null,
      author_id: getCurrentActorId(authorId),
    }

    try {
      await api.createLifecycleEvent(caseId, payload)
      await onSaved()
      setComment('')
      setConfirmationUrl('')
      setStatus('Официальное событие добавлено. Стадия и хронология обновлены с сервера.')
    } catch (caught) {
      setError(lifecycleErrorMessage(caught))
    } finally {
      submitGuard.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <form className="decision-form lifecycle-form" onSubmit={submit}>
      <label className="form-field">
        <span>Следующая стадия</span>
        <select
          aria-label="Стадия"
          required
          value={stage}
          onChange={(event) => setStage(event.target.value as LifecycleStage)}
        >
          {availableStages.map((value) => <option key={value} value={value}>{stageLabels[value]}</option>)}
        </select>
        {hasEvents && (
          <small className="form-help">
            Допустимые переходы предложены первыми; backend отклонит повтор, обратный переход или пропуск стадии.
          </small>
        )}
      </label>
      <label className="form-field">
        <span>Дата события</span>
        <input
          type="datetime-local"
          required
          value={occurredAt}
          onChange={(event) => setOccurredAt(event.target.value)}
        />
      </label>
      <label className="form-field form-field-wide">
        <span>Ссылка на официальное подтверждение</span>
        <input
          type="url"
          required
          value={confirmationUrl}
          onChange={(event) => setConfirmationUrl(event.target.value)}
          placeholder="https://regulator.example/document"
        />
      </label>
      <label className="form-field form-field-wide">
        <span>Тип официального источника</span>
        <select
          aria-label="Тип официального источника"
          aria-describedby="confirmation-source-help"
          value={confirmationSourceType}
          onChange={(event) => setConfirmationSourceType(event.target.value as ConfirmationSourceType)}
        >
          {Object.entries(confirmationSourceLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <small id="confirmation-source-help" className="form-help">
          Неофициальный сигнал сначала связывается с кейсом как публикация.
        </small>
      </label>
      <label className="form-field form-field-wide">
        <span>Комментарий · необязательно</span>
        <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={4} />
      </label>
      <label className="form-field form-field-wide">
        <span>Автор события</span>
        <input required value={authorId} onChange={(event) => setAuthorId(event.target.value)} />
      </label>
      <div className="decision-actions form-field-wide">
        <div>
          <strong>Событие будет добавлено без изменения истории</strong>
          <span>Допустимость перехода окончательно проверяет backend.</span>
        </div>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Добавляем…' : 'Добавить событие'}
        </button>
      </div>
      {status && <p className="action-message form-field-wide" role="status">{status}</p>}
      {error && <p className="form-error form-field-wide" role="alert">{error}</p>}
    </form>
  )
}

function lifecycleErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return 'Переход недопустим. Данные не изменены; обновите кейс и проверьте текущую стадию.'
    }
    if (error.status === 404) {
      return 'Кейс больше не существует.'
    }
    if (error.status === 422) {
      return 'Проверьте поля и выберите допустимый официальный источник. Введённые данные сохранены.'
    }
  }
  return error instanceof Error ? error.message : 'Не удалось добавить официальное событие'
}
