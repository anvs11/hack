import { useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../shared/api/client'
import { useApiResource } from '../shared/api/useApiResource'
import { formatDate } from '../shared/format'
import { PageState } from '../shared/PageState'
import { RevealText } from '../shared/RevealText'

const stageLabels = {
  draft: 'Проект',
  introduced: 'Внесён',
  adopted: 'Принят',
  published: 'Опубликован',
  effective: 'Вступил в силу',
  amended: 'Изменён',
  repealed: 'Отменён',
} as const

export function RegulatoryCasePage() {
  const { id = '' } = useParams()
  const load = useCallback(
    (signal: AbortSignal) => api.getRegulatoryCase(id, signal),
    [id],
  )
  const state = useApiResource(load)

  if (state.status === 'loading') {
    return <PageState kind="loading" title="Открываем кейс НПА" message={`ID: ${id}`} />
  }

  if (state.status === 'error') {
    return <PageState kind="error" title="Кейс не загрузился" message={state.error.message} />
  }

  const { case: regulatoryCase, timeline } = state.data

  return (
    <section>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Кейс НПА · {regulatoryCase.registration_number}</p>
          <RevealText lines={[regulatoryCase.title]} />
          <p className="page-description">Ответственный: {regulatoryCase.responsible_user_id}</p>
        </div>
        <div className="stage-card"><span className="status-dot" aria-hidden="true" /><span>Текущая стадия</span><strong>{stageLabels[regulatoryCase.current_stage]}</strong></div>
      </header>

      <section className="timeline-section">
        <p className="eyebrow">Append-only history</p>
        <div className="timeline-title-row"><h2>Хронология</h2><span>Новые события только добавляются</span></div>
        {timeline.length === 0 ? (
          <PageState kind="empty" title="Событий пока нет" message="В lifecycle ещё не добавлено ни одного события." />
        ) : (
          <ol className="timeline">
            {timeline.map((event, index) => (
              <li key={event.id}>
                <div className="timeline-marker" aria-hidden="true" />
                <div className="timeline-card">
                  <span className="timeline-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  <div className="card-meta"><span>{formatDate(event.effective_at)}</span><span>{event.confirmation_source_type}</span></div>
                  <h3>{stageLabels[event.stage]}</h3>
                  {event.comment && <p>{event.comment}</p>}
                  <a href={event.confirmation_url} target="_blank" rel="noreferrer">Подтверждение в источнике ↗</a>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  )
}
