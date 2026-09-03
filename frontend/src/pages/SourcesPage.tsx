import { useCallback } from 'react'
import { api } from '../shared/api/client'
import { useApiResource } from '../shared/api/useApiResource'
import { formatDate } from '../shared/format'
import { PageState } from '../shared/PageState'

export function SourcesPage() {
  const load = useCallback((signal: AbortSignal) => api.listSources(signal), [])
  const state = useApiResource(load)

  if (state.status === 'loading') {
    return <PageState kind="loading" title="Загружаем источники" message="Проверяем состояние mock-подключений." />
  }

  if (state.status === 'error') {
    return <PageState kind="error" title="Источники не загрузились" message={state.error.message} />
  }

  return (
    <section>
      <header className="page-heading">
        <div><p className="eyebrow">Контур сбора</p><h1>Источники</h1><p className="page-description">Demo-конфигурация без функций редактирования.</p></div>
        <div className="metric-card"><strong>{state.data.filter((source) => source.enabled).length}</strong><span>активных</span></div>
      </header>

      {state.data.length === 0 ? (
        <PageState kind="empty" title="Источников нет" message="В mock-конфигурацию ещё не добавлены источники." />
      ) : (
        <div className="source-list">
          {state.data.map((source) => (
            <article className="source-card" key={source.id}>
              <div className="source-icon" aria-hidden="true">{source.type === 'regulator' ? '§' : source.type === 'rss' ? 'R' : 'T'}</div>
              <div className="source-main"><div className="source-title-row"><h2>{source.name}</h2><span className={`source-status ${source.enabled ? 'enabled' : 'disabled'}`}>{source.enabled ? 'Активен' : 'Пауза'}</span></div><p>{source.id} · {source.type}</p>{source.last_error ? <p className="error-text">{source.last_error}</p> : <p>Последний успех: {source.last_success_at ? formatDate(source.last_success_at) : 'ещё не было'}</p>}</div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
