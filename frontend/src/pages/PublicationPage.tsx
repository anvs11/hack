import { useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../shared/api/client'
import { useApiResource } from '../shared/api/useApiResource'
import { formatCategory, formatDate, formatPriority } from '../shared/format'
import { PageState } from '../shared/PageState'
import { RevealText } from '../shared/RevealText'

export function PublicationPage() {
  const { id = '' } = useParams()
  const load = useCallback(
    (signal: AbortSignal) => api.getPublication(id, signal),
    [id],
  )
  const state = useApiResource(load)

  if (state.status === 'loading') {
    return <PageState kind="loading" title="Открываем публикацию" message={`ID: ${id}`} />
  }

  if (state.status === 'error') {
    return <PageState kind="error" title="Публикация не загрузилась" message={state.error.message} />
  }

  const { publication, latest_analysis: analysis } = state.data

  return (
    <article className="detail-page">
      <Link className="back-link" to="/feed"><span aria-hidden="true">←</span> Вернуться в ленту</Link>
      <header className="detail-heading">
        <div className="card-meta">
          <span>{publication.source_id}</span>
          <span>{formatDate(publication.published_at)}</span>
        </div>
        <RevealText lines={[publication.title]} />
        <a className="source-link" href={publication.original_url} target="_blank" rel="noreferrer">
          Открыть первоисточник ↗
        </a>
      </header>

      <div className="detail-grid">
        <section className="content-panel">
          <div className="panel-index" aria-hidden="true">01</div>
          <p className="eyebrow">Исходный материал</p>
          <h2>Содержание</h2>
          <p>{publication.content}</p>
        </section>

        {analysis ? (
          <section className="analysis-panel">
            <div className="panel-index" aria-hidden="true">02</div>
            <p className="eyebrow">AI-анализ · v{analysis.version}</p>
            <h2>Краткое резюме</h2>
            <p>{analysis.summary}</p>
            <div className="tag-row">
              <span className="tag">{formatCategory(analysis.category)}</span>
              <span className={`priority priority-${analysis.proposed_priority}`}>
                {formatPriority(analysis.proposed_priority)} · AI
              </span>
            </div>
            <dl className="analysis-stats">
              <div><dt>Балл</dt><dd>{analysis.score}</dd></div>
              <div><dt>Неопределённость</dt><dd>{Math.round(analysis.uncertainty * 100)}%</dd></div>
              <div><dt>Проверка</dt><dd>{analysis.needs_review ? 'Нужна' : 'Не нужна'}</dd></div>
            </dl>
          </section>
        ) : (
          <PageState kind="empty" title="AI-анализа нет" message="Для этой публикации ещё нет версии анализа." />
        )}
      </div>
    </article>
  )
}
