import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { api } from '../shared/api/client'
import { useApiResource } from '../shared/api/useApiResource'
import { formatCategory, formatDate, formatPriority, formatSourceName } from '../shared/format'
import { PageState } from '../shared/PageState'
import { ManualPublicationDialog } from '../shared/ManualPublicationDialog'
import { ReportButton, useReport } from '../shared/ReportStore'
import { decisionStatus } from '../shared/report'
import {
  categories,
  priorities,
  sourceTypes,
  sourceTypeLabel,
  filterLabels,
  parseFeedQuery,
  dateError,
  dateBoundary,
  localDay,
} from '../shared/feedQuery'
import { SignalMap } from '../shared/SignalMap'

// Position belongs to the exact result URL; it never changes the server order.
const positions = new Map<string, number>()
const feedRefreshIntervalMs = 15 * 60 * 1000
export function FeedPage() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const report = useReport()
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [actionStatus, setActionStatus] = useState('')
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const startupFiltersChecked = useRef(false)
  useEffect(() => {
    const timer = window.setInterval(
      () => setRefreshVersion((version) => version + 1),
      feedRefreshIntervalMs,
    )
    return () => window.clearInterval(timer)
  }, [])
  const query = useMemo(() => parseFeedQuery(params), [params])
  const invalidDates = dateError(query)
  const load = useCallback(
    (signal: AbortSignal) => {
      void refreshVersion
      return invalidDates
        ? Promise.reject(new Error(invalidDates))
        : api.listPublications(query, signal)
    },
    [query, refreshVersion, invalidDates],
  )
  const state = useApiResource(load)
  const sources = useApiResource(
    useCallback((signal: AbortSignal) => api.listSources(signal), []),
  )
  const items = state.status === 'success' ? state.data.items : []
  const total = state.status === 'success' ? state.data.total : null
  const sourceMap = new Map(sources.data?.map((s) => [s.id, s]))
  const active = Object.entries(query).filter(
    ([k, v]) => k in filterLabels && v !== undefined,
  )
  const advancedCount = active.filter(([k]) =>
    ['source_id', 'source_type', 'needs_review', 'visibility'].includes(k),
  ).length
  const limit = query.limit ?? 10
  const offset = query.offset ?? 0
  const returnTo = `/feed${location.search}`
  const restored = useRef('')
  useEffect(() => {
    if (startupFiltersChecked.current) return
    startupFiltersChecked.current = true
    if (location.search) return
    const controller = new AbortController()
    api.getMyProfile(controller.signal).then((profile) => {
      const saved = new URLSearchParams()
      Object.entries(profile.start_filters).forEach(([key, value]) => {
        if (key in filterLabels && value !== undefined && value !== '')
          saved.set(key, String(value))
      })
      if ([...saved].length) setParams(saved, { replace: true })
    }).catch(() => {
      // The unfiltered feed remains usable if preferences are unavailable.
    })
    return () => controller.abort()
  }, [location.search, setParams])
  useEffect(() => {
    restored.current = ''
    const save = () => {
      if (restored.current === returnTo) positions.set(returnTo, window.scrollY)
    }
    window.addEventListener('scroll', save, { passive: true })
    return () => window.removeEventListener('scroll', save)
  }, [returnTo])
  useEffect(() => {
    if (state.status !== 'success') {
      restored.current = ''
      return
    }
    if (restored.current !== returnTo) {
      const position = positions.get(returnTo) ?? 0
      const frame = requestAnimationFrame(() => {
        window.scrollTo({ top: position, behavior: 'instant' })
        // A cancelled frame must not mark an incoming result as restored.
        restored.current = returnTo
      })
      return () => cancelAnimationFrame(frame)
    }
  }, [state.status, returnTo])
  useEffect(() => setSelection(new Set()), [location.search])
  function update(key: string, value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value)
      else next.delete(key)
      if (key !== 'offset') next.delete('offset')
      return next
    })
  }
  function period(days: number | null) {
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('offset')
      if (days === null) {
        next.delete('published_from')
        next.delete('published_to')
      } else {
        const now = new Date()
        const start = new Date(now)
        start.setDate(start.getDate() - days + 1)
        next.set('published_from', dateBoundary(localDay(start.toISOString())))
        next.set(
          'published_to',
          dateBoundary(localDay(now.toISOString()), true),
        )
      }
      return next
    })
  }
  const reset = () => setParams(new URLSearchParams())
  const toggle = (id: string) =>
    setSelection((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  return (
    <section
      className="feed-page"
      onClickCapture={(event) => {
        // Capture before navigation; the browser may not have emitted scroll yet.
        if (
          event.target instanceof Element &&
          event.target.closest('a[href^="/publications/"]')
        )
          positions.set(returnTo, window.scrollY)
      }}
    >
      <header className="workspace-heading">
        <div>
          <p className="eyebrow">Рабочая лента</p>
          <h1>
            Мониторинг{' '}
            <span
              className="heading-count"
              aria-label={
                total === null ? 'Загрузка количества' : `${total} публикаций`
              }
            >
              {total ?? '—'}
            </span>
          </h1>
        </div>
        {sources.data && (
          <ManualPublicationDialog
            sources={sources.data}
            onCreated={(title) => {
              setActionStatus(`Публикация «${title}» добавлена.`)
              setRefreshVersion((v) => v + 1)
            }}
          />
        )}
      </header>
      <section
        className="feed-controls"
        aria-label="Поиск и фильтры публикаций"
      >
        <SearchField
          key={params.get('q') ?? ''}
          value={params.get('q') ?? ''}
          onApply={(value) => update('q', value)}
        />
        <div className="primary-filters">
          <label className="filter-field">
            <span>Категория</span>
            <select
              aria-label="Категория"
              value={query.category ?? ''}
              onChange={(e) => update('category', e.target.value)}
            >
              <option value="">Все категории</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {formatCategory(c)}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>AI-приоритет</span>
            <select
              aria-label="AI-приоритет"
              value={query.proposed_priority ?? ''}
              onChange={(e) => update('proposed_priority', e.target.value)}
            >
              <option value="">Все приоритеты</option>
              {priorities.map((p) => (
                <option key={p} value={p}>
                  {formatPriority(p)}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Дата с</span>
            <input
              type="date"
              value={localDay(query.published_from)}
              onChange={(e) =>
                update('published_from', dateBoundary(e.target.value))
              }
            />
          </label>
          <label className="filter-field">
            <span>Дата по</span>
            <input
              type="date"
              value={localDay(query.published_to)}
              onChange={(e) =>
                update('published_to', dateBoundary(e.target.value, true))
              }
            />
          </label>
        </div>
        <div className="filter-bottom">
          <div className="quick-periods" aria-label="Быстрые периоды">
            <span>Период</span>
            <button
              type="button"
              aria-pressed={!query.published_from && !query.published_to}
              onClick={() => period(null)}
            >
              Всё время
            </button>
            <button type="button" onClick={() => period(1)}>
              Сегодня
            </button>
            <button type="button" onClick={() => period(7)}>
              7 дней
            </button>
            <button type="button" onClick={() => period(30)}>
              30 дней
            </button>
          </div>
          <button
            className="text-button"
            type="button"
            onClick={reset}
            disabled={!active.length}
          >
            Сбросить
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => {
              const startFilters = Object.fromEntries(
                Object.entries(query).filter(
                  ([key, value]) =>
                    key in filterLabels && value !== undefined,
                ),
              )
              void api.updateMyPreferences({
                start_filters: startFilters,
              }).then(() => {
                setActionStatus(
                  active.length
                    ? 'Текущие фильтры сохранены как стартовые.'
                    : 'Стартовые фильтры очищены.',
                )
              }).catch((error) => {
                setActionStatus(
                  error instanceof Error
                    ? `Не удалось сохранить фильтры: ${error.message}`
                    : 'Не удалось сохранить стартовые фильтры.',
                )
              })
            }}
          >
            {active.length ? 'Сделать стартовыми' : 'Без стартовых фильтров'}
          </button>
        </div>
        <details
          className="advanced-filters"
          open={advancedCount > 0 || undefined}
        >
          <summary>
            Все фильтры{' '}
            {advancedCount > 0 && (
              <span className="count-badge">{advancedCount}</span>
            )}
          </summary>
          <div className="primary-filters">
            <label className="filter-field">
              <span>Источник</span>
              <select
                aria-label="Источник"
                value={query.source_id ?? ''}
                onChange={(e) => update('source_id', e.target.value)}
              >
                <option value="">Все источники</option>
                {sources.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatSourceName(s.name)}
                  </option>
                ))}
                {query.source_id && !sourceMap.has(query.source_id) && (
                  <option value={query.source_id}>{query.source_id}</option>
                )}
              </select>
            </label>
            <label className="filter-field">
              <span>Тип источника</span>
              <select
                aria-label="Тип источника"
                value={query.source_type ?? ''}
                onChange={(e) => update('source_type', e.target.value)}
              >
                <option value="">Все типы</option>
                {sourceTypes.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Флаг проверки AI</span>
              <select
                aria-label="Флаг проверки AI"
                value={
                  query.needs_review === undefined
                    ? ''
                    : String(query.needs_review)
                }
                onChange={(e) => update('needs_review', e.target.value)}
              >
                <option value="">Все значения</option>
                <option value="true">AI требует проверки</option>
                <option value="false">AI не запрашивает проверку</option>
              </select>
            </label>
            <label className="filter-field">
              <span>Видимость</span>
              <select
                aria-label="Видимость"
                value={query.visibility ?? 'active'}
                onChange={(e) =>
                  update(
                    'visibility',
                    e.target.value === 'active' ? '' : e.target.value,
                  )
                }
              >
                <option value="active">Активные</option>
                <option value="hidden">Скрытые</option>
                <option value="all">Все публикации</option>
              </select>
            </label>
          </div>
        </details>
        {invalidDates && (
          <p className="form-error" role="alert">
            {invalidDates}
          </p>
        )}
        {active.length > 0 && (
          <div className="active-filters" aria-label="Применённые фильтры">
            {active.map(([key, value]) => {
              const label =
                key === 'category'
                  ? formatCategory(query.category!)
                  : key === 'proposed_priority'
                    ? formatPriority(query.proposed_priority!)
                    : key === 'source_id'
                          ? formatSourceName(sourceMap.get(String(value))?.name ?? String(value))
                      : key.startsWith('published_')
                        ? localDay(String(value))
                        : key === 'needs_review'
                          ? value
                            ? 'Требует проверки'
                            : 'Не запрашивает'
                          : key === 'source_type'
                            ? sourceTypeLabel(String(value))
                            : key === 'visibility'
                              ? {
                                  hidden: 'Скрытые',
                                  all: 'Все',
                                  active: 'Активные',
                                }[String(value)]
                              : value
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => update(key, '')}
                  aria-label={`Удалить фильтр ${filterLabels[key]}`}
                >
                  {filterLabels[key]}: {String(label)}{' '}
                  <span aria-hidden="true">×</span>
                </button>
              )
            })}
          </div>
        )}
      </section>
      {actionStatus && (
        <p className="action-message" role="status">
          {actionStatus}
        </p>
      )}
      {sources.status === 'error' && (
        <p className="inline-warning">
          Названия источников недоступны. Публикации показаны с ID источников.
        </p>
      )}
      <div className="monitor-layout">
        <div className="feed-results">
          <div className="feed-summary-bar">
            <div className="results-toolbar">
              <div>
                <strong>
                  {total === null
                    ? 'Загружаем публикации'
                    : `Найдено: ${total}`}
                </strong>
                <span className="sort-note">Сначала новые</span>
              </div>
              <span className="muted">Активно: {active.length}</span>
            </div>
            {items.length > 0 && (
              <div className="selection-toolbar">
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={items.every((i) =>
                      selection.has(i.publication.id),
                    )}
                    onChange={(e) =>
                      setSelection(
                        new Set(
                          e.target.checked
                            ? items.map((i) => i.publication.id)
                            : [],
                        ),
                      )
                    }
                  />
                  Выбрать страницу
                </label>
                <button
                  disabled={!selection.size}
                  type="button"
                  onClick={() => {
                    report.add(
                      items
                        .filter((i) => selection.has(i.publication.id))
                        .map((detail) => ({
                          detail,
                          source: sourceMap.get(detail.publication.source_id),
                        })),
                    )
                    setActionStatus(
                      `Выбранные материалы добавлены в отчёт: ${selection.size}. Повторы исключены.`,
                    )
                    setSelection(new Set())
                  }}
                >
                  В отчёт{selection.size > 0 && ` (${selection.size})`}{' '}
                  <span aria-hidden="true">↗</span>
                </button>
              </div>
            )}
          </div>
          {state.status === 'loading' && (
            <PageState
              kind="loading"
              title="Собираем ленту"
              message="Получаем публикации и последние AI-анализы."
            />
          )}
          {state.status === 'error' && !invalidDates && (
            <PageState
              kind="error"
              title="Лента не загрузилась"
              message={state.error.message}
              action={
                <button onClick={() => setRefreshVersion((v) => v + 1)}>
                  Повторить
                </button>
              }
            />
          )}
          {state.status === 'success' && !items.length && (
            <PageState
              kind="empty"
              title={
                active.length
                  ? 'Ничего не найдено'
                  : offset
                    ? 'На этой странице нет материалов'
                    : 'Публикаций нет'
              }
              message={
                active.length
                  ? 'Измените запрос или сбросьте выбранные фильтры.'
                  : 'В ленте пока нет материалов.'
              }
              action={
                <button onClick={offset ? () => update('offset', '') : reset}>
                  {offset ? 'На первую страницу' : 'Сбросить поиск и фильтры'}
                </button>
              }
            />
          )}
          {items.length > 0 && (
            <>
              <div className="card-list">
                {items.map((detail) => {
                  const { publication: p, latest_analysis: a } = detail
                  const source = sourceMap.get(p.source_id)
                  return (
                    <article
                      id={`publication-${p.id}`}
                      className={`publication-card ${highlighted === p.id ? 'highlighted' : ''}`}
                      key={p.id}
                      onMouseEnter={() => setHighlighted(p.id)}
                      onMouseLeave={() => setHighlighted(null)}
                      onFocus={() => setHighlighted(p.id)}
                      onBlur={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget))
                          setHighlighted(null)
                      }}
                    >
                      <div className="card-top">
                        <div className="card-meta">
                          <span className="source-avatar" aria-hidden="true">
                            {formatSourceName(source?.name ?? p.source_id).charAt(0)}
                          </span>
                          <span
                            className="card-source-name"
                            title={source?.name ?? p.source_id}
                          >
                            {formatSourceName(source?.name ?? p.source_id)}
                          </span>
                          <span>{sourceTypeLabel(source?.type)}</span>
                          <time dateTime={p.published_at}>
                            {formatDate(p.published_at)}
                          </time>
                        </div>
                        <input
                          type="checkbox"
                          aria-label={`Выбрать: ${p.title}`}
                          checked={selection.has(p.id)}
                          onChange={() => toggle(p.id)}
                        />
                      </div>
                      <h2>
                        <Link
                          to={`/publications/${encodeURIComponent(p.id)}`}
                          state={{ returnTo }}
                          onClick={() =>
                            positions.set(returnTo, window.scrollY)
                          }
                        >
                          {p.title}
                        </Link>
                      </h2>
                      <p className="card-summary">
                        {!a && <strong>Фрагмент исходного материала: </strong>}
                        {a?.summary ??
                          `${p.content.slice(0, 320)}${p.content.length > 320 ? '…' : ''}`}
                      </p>
                      <div className="tag-row">
                        {a ? (
                          <>
                            <span className={`tag category-${a.category}`}>
                              Категория · {formatCategory(a.category)}
                            </span>
                            <span className={`priority priority-${a.proposed_priority}`}>
                              AI-приоритет · {formatPriority(a.proposed_priority)}
                            </span>
                          </>
                        ) : (
                          <span className="tag category-unknown">
                            AI-анализ в очереди
                          </span>
                        )}
                      </div>
                      {p.tags.length > 0 && (
                        <div className="news-tags">
                          {p.tags.map((t) => (
                            <span key={t}>#{t}</span>
                          ))}
                        </div>
                      )}
                      <div className="card-bottom">
                        <div className="decision-line">
                          <span className="human-status">
                            {decisionStatus(detail)}
                          </span>
                          <span>
                            {a
                              ? a.needs_review
                                ? 'AI требует проверки'
                                : 'AI не запрашивает проверку'
                              : 'Нет AI-анализа'}
                          </span>
                          {p.is_hidden && <span>Скрыта</span>}
                        </div>
                        <div className="card-actions">
                          <Link
                            className="analysis-link"
                            to={`/publications/${encodeURIComponent(p.id)}`}
                            state={{ returnTo }}
                            onClick={() =>
                              positions.set(returnTo, window.scrollY)
                            }
                          >
                            Открыть анализ <span aria-hidden="true">↗</span>
                          </Link>
                          <a
                            className="original-link"
                            href={p.original_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Открыть оригинал
                          </a>
                          <ReportButton detail={detail} source={source} />
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            </>
          )}
          {total !== null && total > 0 && (
            <nav className="pagination" aria-label="Страницы публикаций">
              <button
                disabled={offset === 0}
                onClick={() =>
                  update('offset', String(Math.max(0, offset - limit)))
                }
              >
                ← Назад
              </button>
              <span>
                {Math.min(offset + 1, total)}–
                {Math.min(offset + items.length, total)} из {total}
              </span>
              <button
                disabled={offset + limit >= total}
                onClick={() => update('offset', String(offset + limit))}
              >
                Далее →
              </button>
              <label>
                На странице
                <select
                  value={limit}
                  onChange={(e) => update('limit', e.target.value)}
                >
                  {[...new Set([5, 10, 20, 50, limit])]
                    .sort((a, b) => a - b)
                    .map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                </select>
              </label>
            </nav>
          )}
        </div>
        <aside className="monitor-aside">
          <SignalMap
            sourceNames={Object.fromEntries(
              [...sourceMap].map(([id, source]) => [id, formatSourceName(source.name)]),
            )}
            items={items}
            total={total ?? 0}
            highlighted={highlighted}
            onHighlight={setHighlighted}
            returnTo={returnTo}
          />
          <section className="report-mini">
            <div className="panel-heading">
              <h2>В вашем отчёте</h2>
              <span className="count-badge">{report.draft.items.length}</span>
            </div>
            {report.draft.items.length ? (
              <ol>
                {report.draft.items.slice(0, 3).map((i) => (
                  <li key={i.id}>
                    <Link to={`/publications/${encodeURIComponent(i.id)}`}>
                      {i.detail.publication.title}
                    </Link>
                    <button
                      type="button"
                      aria-label={`Удалить из отчёта: ${i.detail.publication.title}`}
                      onClick={() => report.remove(i.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p>
                Добавляйте важные материалы из ленты. Соберите обзор с
                комментариями для руководителя.
              </p>
            )}
            <Link className="report-open" to="/digest">
              Открыть отчёт <span aria-hidden="true">→</span>
            </Link>
            <small>
              {report.warning
                ? 'Есть несохранённые изменения'
                : 'Черновик сохранён в этом браузере'}
            </small>
          </section>
        </aside>
      </div>
    </section>
  )
}
function SearchField({
  value,
  onApply,
}: {
  value: string
  onApply: (value: string) => void
}) {
  const [text, setText] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const apply = useRef(onApply)
  apply.current = onApply
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  return (
    <form
      className="search-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (timer.current) clearTimeout(timer.current)
        onApply(text.trim())
      }}
    >
      <label className="search-field">
        <span className="sr-only">Поиск по ленте</span>
        <span aria-hidden="true" className="search-icon">
          ⌕
        </span>
        <input
          type="search"
          aria-label="Поиск по ленте"
          placeholder="Поиск по публикациям, компаниям и темам…"
          value={text}
          onChange={(e) => {
            const v = e.target.value
            setText(v)
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => apply.current(v.trim()), 300)
          }}
        />
      </label>
      <button className="primary-action" type="submit">
        Найти
      </button>
    </form>
  )
}
