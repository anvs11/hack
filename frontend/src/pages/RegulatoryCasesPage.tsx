import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../shared/api/client'
import { useApiResource } from '../shared/api/useApiResource'
import { digestLabels } from '../shared/digest'
import { formatDate } from '../shared/format'
import { PageState } from '../shared/PageState'
export function RegulatoryCasesPage() {
  const state = useApiResource(
    useCallback((signal: AbortSignal) => api.listRegulatoryCases(signal), []),
  )
  return (
    <section>
      <header className="workspace-heading">
        <div>
          <p className="eyebrow">Регуляторная повестка</p>
          <h1>Кейсы НПА</h1>
        </div>
      </header>
      {state.status === 'loading' && (
        <PageState
          kind="loading"
          title="Загружаем кейсы"
          message="Получаем список НПА."
        />
      )}
      {state.status === 'error' && (
        <PageState
          kind="error"
          title="Кейсы не загрузились"
          message={state.error.message}
        />
      )}
      {state.data?.length === 0 && (
        <PageState
          kind="empty"
          title="Кейсов пока нет"
          message="В подключённом источнике данных нет кейсов НПА."
        />
      )}
      <div className="case-list">
        {state.data?.map((c) => (
          <article key={c.id}>
            <p className="eyebrow">{c.registration_number}</p>
            <h2>
              <Link to={`/regulatory-cases/${encodeURIComponent(c.id)}`}>
                {c.title}
              </Link>
            </h2>
            <div className="tag-row">
              <span className="tag">{digestLabels.stage[c.current_stage]}</span>
              <span className="muted">
                {c.related_publication_ids.length} связанных публикаций ·
                Обновлено {formatDate(c.updated_at)}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
