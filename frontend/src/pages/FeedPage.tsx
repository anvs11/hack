import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../shared/api/client'
import { useApiResource } from '../shared/api/useApiResource'
import { formatCategory, formatDate, formatPriority } from '../shared/format'
import { PageState } from '../shared/PageState'

export function FeedPage() {
  const load = useCallback((signal: AbortSignal) => api.listPublications(signal), [])
  const state = useApiResource(load)

  if (state.status === 'loading') {
    return (
      <PageState
        kind="loading"
        title="Собираем ленту"
        message="Получаем публикации и последние AI-анализы."
      />
    )
  }

  if (state.status === 'error') {
    return (
      <PageState
        kind="error"
        title="Лента не загрузилась"
        message={state.error.message}
      />
    )
  }

  return (
    <section>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Мониторинг</p>
          <h1>Лента сигналов</h1>
          <p className="page-description">
            Публикации из demo-источников с предложенным AI-приоритетом.
          </p>
        </div>
        <div className="metric-card" aria-label={`${state.data.total} публикаций`}>
          <strong>{state.data.total}</strong>
          <span>материалов</span>
        </div>
      </header>

      {state.data.items.length === 0 ? (
        <PageState
          kind="empty"
          title="Публикаций нет"
          message="В mock-ленте пока нет материалов."
        />
      ) : (
        <div className="card-list">
          {state.data.items.map(({ publication, latest_analysis: analysis }) => (
            <article className="publication-card" key={publication.id}>
              <div className="card-meta">
                <span>{formatDate(publication.published_at)}</span>
                <span>{publication.source_id}</span>
              </div>
              <h2>
                <Link to={`/publications/${publication.id}`}>{publication.title}</Link>
              </h2>
              {analysis ? (
                <div className="tag-row">
                  <span className="tag">{formatCategory(analysis.category)}</span>
                  <span className={`priority priority-${analysis.proposed_priority}`}>
                    {formatPriority(analysis.proposed_priority)} · AI
                  </span>
                </div>
              ) : (
                <span className="tag">Без AI-анализа</span>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
