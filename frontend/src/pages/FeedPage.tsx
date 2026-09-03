import { lazy, Suspense, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../shared/api/client'
import { useApiResource } from '../shared/api/useApiResource'
import { formatCategory, formatDate, formatPriority } from '../shared/format'
import { PageState } from '../shared/PageState'
import { RevealText } from '../shared/RevealText'

const HeroVisual = lazy(() => import('../shared/HeroVisual'))

export function FeedPage() {
  const load = useCallback((signal: AbortSignal) => api.listPublications(signal), [])
  const state = useApiResource(load)

  return (
    <section className="feed-page">
      <header className="feed-hero">
        <div className="hero-copy">
          <p className="eyebrow">Аналитический центр · Live demo</p>
          <RevealText
            lines={['Видеть сигнал.', 'Понимать влияние.', 'Действовать раньше.']}
          />
          <div className="hero-intro">
            <p>
              Единый поток СМИ, регуляторных источников и отраслевых каналов —
              уже собран, объяснён и расставлен по приоритетам.
            </p>
            <a href="#signal-feed" className="round-link" aria-label="Перейти к ленте сигналов">↓</a>
          </div>
        </div>
        <Suspense fallback={<div className="hero-visual hero-visual-loading" aria-hidden="true" />}>
          <HeroVisual />
        </Suspense>
      </header>

      <section className="feed-section" id="signal-feed" aria-labelledby="feed-heading">
        <header className="section-heading">
          <div>
            <p className="eyebrow">Сегодня в фокусе</p>
            <h1 id="feed-heading">Лента сигналов</h1>
          </div>
          <div className="metric-card" aria-label={`${state.status === 'success' ? state.data.total : 0} публикаций`}>
            <strong>{state.status === 'success' ? String(state.data.total).padStart(2, '0') : '—'}</strong>
            <span>материалов</span>
          </div>
        </header>

        {state.status === 'loading' && (
          <PageState
            kind="loading"
            title="Собираем ленту"
            message="Получаем публикации и последние AI-анализы."
          />
        )}

        {state.status === 'error' && (
          <PageState
            kind="error"
            title="Лента не загрузилась"
            message={state.error.message}
          />
        )}

        {state.status === 'success' && state.data.items.length === 0 && (
          <PageState
            kind="empty"
            title="Публикаций нет"
            message="В mock-ленте пока нет материалов."
          />
        )}

        {state.status === 'success' && state.data.items.length > 0 && (
          <div className="card-list">
            {state.data.items.map(({ publication, latest_analysis: analysis }, index) => (
              <article className="publication-card" key={publication.id}>
                <div className="card-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</div>
                <div className="card-meta">
                  <span>{formatDate(publication.published_at)}</span>
                  <span>{publication.source_id}</span>
                </div>
                <h2>
                  <Link to={`/publications/${publication.id}`}>
                    {publication.title}
                    <span className="card-arrow" aria-hidden="true">↗</span>
                  </Link>
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
    </section>
  )
}
