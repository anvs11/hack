import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../shared/api/client'
import type {
  Category,
  Priority,
  PublicationQuery,
  SourceType,
} from '../shared/api/types'
import { useApiResource } from '../shared/api/useApiResource'
import { formatCategory, formatDate, formatPriority } from '../shared/format'
import { PageState } from '../shared/PageState'
import { sortPublications } from '../shared/publications'
import { RevealText } from '../shared/RevealText'

const HeroVisual = lazy(() => import('../shared/HeroVisual'))
const SEARCH_DEBOUNCE_MS = 300

const categories = [
  'regulation',
  'reputation',
  'competitor',
  'trend',
  'unknown',
] as const satisfies readonly Category[]
const priorities = [
  'critical',
  'high',
  'medium',
  'low',
  'unknown',
] as const satisfies readonly Priority[]
const sourceTypes = [
  ['rss', 'СМИ / RSS'],
  ['regulator', 'Регулятор'],
  ['telegram', 'Telegram'],
  ['telegram_archive', 'Telegram-архив'],
  ['file', 'Файл'],
  ['seed', 'Demo seed'],
] as const satisfies readonly (readonly [SourceType, string])[]

const queryFilterKeys = [
  'source_id',
  'source_type',
  'category',
  'proposed_priority',
  'needs_review',
] as const

function allowedValue<T extends string>(
  value: string | null,
  options: readonly T[],
): T | undefined {
  return value && options.includes(value as T) ? value as T : undefined
}

function queryFromUrl(searchParams: URLSearchParams): PublicationQuery {
  const q = searchParams.get('q')?.trim() || undefined
  const sourceId = searchParams.get('source_id')?.trim() || undefined
  const sourceType = allowedValue(
    searchParams.get('source_type'),
    sourceTypes.map(([value]) => value),
  )
  const category = allowedValue(searchParams.get('category'), categories)
  const proposedPriority = allowedValue(
    searchParams.get('proposed_priority'),
    priorities,
  )
  const reviewValue = searchParams.get('needs_review')

  return {
    q,
    source_id: sourceId,
    source_type: sourceType,
    category,
    proposed_priority: proposedPriority,
    needs_review: reviewValue === 'true'
      ? true
      : reviewValue === 'false'
        ? false
        : undefined,
  }
}

export function FeedPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlSearchValue = searchParams.get('q') ?? ''
  const [searchValue, setSearchValue] = useState(urlSearchValue)
  const query = useMemo(() => queryFromUrl(searchParams), [searchParams])
  const loadPublications = useCallback(
    (signal: AbortSignal) => api.listPublications(query, signal),
    [query],
  )
  const loadSources = useCallback((signal: AbortSignal) => api.listSources(signal), [])
  const loadAllCount = useCallback(
    (signal: AbortSignal) => api.listPublications({ limit: 1 }, signal),
    [],
  )
  const publicationsState = useApiResource(loadPublications)
  const sourcesState = useApiResource(loadSources)
  const allCountState = useApiResource(loadAllCount)

  useEffect(() => setSearchValue(urlSearchValue), [urlSearchValue])

  useEffect(() => {
    const normalizedValue = searchValue.trim()
    if (normalizedValue === urlSearchValue) return

    const timeout = setTimeout(() => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current)
        if (normalizedValue) next.set('q', normalizedValue)
        else next.delete('q')
        return next
      })
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timeout)
  }, [searchValue, setSearchParams, urlSearchValue])

  const updateFilter = (key: typeof queryFilterKeys[number], value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    })
  }
  const reset = () => setSearchParams(new URLSearchParams())
  const activeFilterCount = queryFilterKeys.filter((key) => query[key] !== undefined).length
  const hasCriteria = Boolean(query.q || activeFilterCount)
  const isLoading = publicationsState.status === 'loading' ||
    sourcesState.status === 'loading' || allCountState.status === 'loading'
  const error = publicationsState.status === 'error'
    ? publicationsState.error
    : sourcesState.status === 'error'
      ? sourcesState.error
      : allCountState.status === 'error'
        ? allCountState.error
        : null
  const total = publicationsState.status === 'success' ? publicationsState.data.total : 0
  const items = publicationsState.status === 'success'
    ? sortPublications(publicationsState.data.items)
    : []
  const sourceNames = new Map(
    sourcesState.status === 'success'
      ? sourcesState.data.map((source) => [source.id, source.name])
      : [],
  )

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
          <div className="metric-card" aria-label={`${total} публикаций`}>
            <strong>{publicationsState.status === 'success' ? String(total).padStart(2, '0') : '—'}</strong>
            <span>материалов</span>
          </div>
        </header>

        <section className="feed-controls" aria-label="Поиск и фильтры публикаций">
          <label className="search-field">
            <span>Поиск по ленте</span>
            <input
              type="search"
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="Проект, компания, тема…"
            />
          </label>

          <div className="filter-heading">
            <span>Фильтры</span>
            <span className="filter-count" aria-live="polite">
              Активно: {activeFilterCount}
            </span>
          </div>

          <div className="filter-grid">
            <label className="filter-field">
              <span>Источник</span>
              <select value={query.source_id ?? ''} onChange={(event) => updateFilter('source_id', event.target.value)}>
                <option value="">Все источники</option>
                {sourcesState.status === 'success' && sourcesState.data.map((source) => (
                  <option value={source.id} key={source.id}>{source.name}</option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Тип источника</span>
              <select value={query.source_type ?? ''} onChange={(event) => updateFilter('source_type', event.target.value)}>
                <option value="">Все типы</option>
                {sourceTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <label className="filter-field">
              <span>Категория</span>
              <select value={query.category ?? ''} onChange={(event) => updateFilter('category', event.target.value)}>
                <option value="">Все категории</option>
                {categories.map((category) => <option value={category} key={category}>{formatCategory(category)}</option>)}
              </select>
            </label>
            <label className="filter-field">
              <span>AI-приоритет</span>
              <select value={query.proposed_priority ?? ''} onChange={(event) => updateFilter('proposed_priority', event.target.value)}>
                <option value="">Все приоритеты</option>
                {priorities.map((priority) => <option value={priority} key={priority}>{formatPriority(priority)}</option>)}
              </select>
            </label>
            <label className="filter-field">
              <span>Статус проверки</span>
              <select
                value={query.needs_review === undefined ? '' : String(query.needs_review)}
                onChange={(event) => updateFilter('needs_review', event.target.value)}
              >
                <option value="">Все статусы</option>
                <option value="true">Требует проверки</option>
                <option value="false">Проверено AI</option>
              </select>
            </label>
            <button className="reset-button" type="button" onClick={reset} disabled={!hasCriteria}>
              Сбросить
            </button>
          </div>
        </section>

        <div className="feed-results" aria-live="polite">
          {isLoading && (
            <PageState
              kind="loading"
              title="Собираем ленту"
              message="Получаем публикации и последние AI-анализы."
            />
          )}

          {!isLoading && error && (
            <PageState kind="error" title="Лента не загрузилась" message={error.message} />
          )}

          {!isLoading && !error && publicationsState.status === 'success' &&
            allCountState.status === 'success' && allCountState.data.total === 0 && (
            <PageState
              kind="empty"
              title="Публикаций нет"
              message="В mock-ленте пока нет материалов."
            />
          )}

          {!isLoading && !error && items.length === 0 &&
            allCountState.status === 'success' && allCountState.data.total > 0 && (
            <PageState
              kind="empty"
              title="Ничего не найдено"
              message="Измените запрос или сбросьте выбранные фильтры."
              action={<button className="button-link state-action" type="button" onClick={reset}>Сбросить поиск и фильтры</button>}
            />
          )}

          {!isLoading && !error && items.length > 0 && (
            <div className="card-list">
              {items.map(({ publication, latest_analysis: analysis }, index) => (
                <article className="publication-card" key={publication.id}>
                  <div className="card-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</div>
                  <div className="card-meta">
                    <span>{formatDate(publication.published_at)}</span>
                    <span>{sourceNames.get(publication.source_id) ?? publication.source_id}</span>
                  </div>
                  <h2>
                    <Link to={`/publications/${publication.id}`}>
                      {publication.title}
                      <span className="card-arrow" aria-hidden="true">↗</span>
                    </Link>
                  </h2>
                  <div className="tag-row">
                    <span className="tag">Категория · {formatCategory(analysis?.category ?? 'unknown')}</span>
                    <span className={`priority priority-${analysis?.proposed_priority ?? 'unknown'}`}>
                      AI-приоритет · {formatPriority(analysis?.proposed_priority ?? 'unknown')}
                    </span>
                    {analysis ? (
                      <span className={`review-status ${analysis.needs_review ? 'needs-review' : 'reviewed'}`}>
                        {analysis.needs_review ? 'Требует проверки' : 'Проверено AI'}
                      </span>
                    ) : (
                      <span className="review-status needs-review">Нет AI-анализа</span>
                    )}
                  </div>
                  <a
                    className="original-link"
                    href={publication.original_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Открыть оригинал <span aria-hidden="true">↗</span>
                  </a>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </section>
  )
}
