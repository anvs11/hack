import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  buildDigestSnapshot,
  digestFilename,
  digestLabels,
  downloadDigest,
  loadDigestSourceData,
  serializeDigestJson,
  serializeDigestMarkdown,
  type DigestSnapshot,
} from '../shared/digest'
import { formatDate } from '../shared/format'
import { PageState } from '../shared/PageState'
import { RevealText } from '../shared/RevealText'

type DigestState =
  | { status: 'loading'; snapshot: DigestSnapshot | null }
  | { status: 'success'; snapshot: DigestSnapshot }
  | { status: 'error'; snapshot: null; message: string }

const counterItems = [
  { key: 'critical_materials', label: 'Критические' },
  { key: 'lifecycle_changes', label: 'Стадии НПА' },
  { key: 'review_queue', label: 'На проверке' },
  { key: 'user_actions', label: 'Действия' },
] as const

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Неизвестная ошибка загрузки'
}

function SectionEmpty({ message }: { message: string }) {
  return <div className="digest-section-empty" role="status">{message}</div>
}

export function DigestPage() {
  const [requestVersion, setRequestVersion] = useState(0)
  const [state, setState] = useState<DigestState>({ status: 'loading', snapshot: null })

  useEffect(() => {
    const controller = new AbortController()
    setState((current) => ({
      status: 'loading',
      snapshot: current.status === 'success' ? current.snapshot : null,
    }))

    loadDigestSourceData(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return
        const generatedAt = new Date().toISOString()
        setState({ status: 'success', snapshot: buildDigestSnapshot(data, generatedAt) })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', snapshot: null, message: errorMessage(error) })
      })

    return () => controller.abort()
  }, [requestVersion])

  const snapshot = state.snapshot
  const canExport = state.status === 'success'

  const downloadJson = () => {
    if (!canExport) return
    downloadDigest(
      serializeDigestJson(state.snapshot),
      digestFilename(state.snapshot.generated_at, 'json'),
      'application/json;charset=utf-8',
    )
  }

  const downloadMarkdown = () => {
    if (!canExport) return
    downloadDigest(
      serializeDigestMarkdown(state.snapshot),
      digestFilename(state.snapshot.generated_at, 'md'),
      'text/markdown;charset=utf-8',
    )
  }

  return (
    <section className="digest-page">
      <header className="page-heading digest-heading">
        <div>
          <p className="eyebrow">Все доступные данные</p>
          <RevealText lines={['Дайджест для', 'руководителя']} />
          <p className="page-description">
            Подтверждённые сигналы, изменения НПА, очередь проверки и сохранённые действия команды.
          </p>
        </div>
        <div className="digest-heading-actions" aria-label="Действия с дайджестом">
          <button
            className="digest-button digest-button-primary"
            type="button"
            disabled={state.status === 'loading'}
            onClick={() => setRequestVersion((version) => version + 1)}
          >
            {state.status === 'loading' ? 'Обновляем…' : 'Обновить'}
          </button>
          <button className="digest-button" type="button" disabled={!canExport} onClick={downloadJson}>
            Скачать JSON
          </button>
          <button className="digest-button" type="button" disabled={!canExport} onClick={downloadMarkdown}>
            Скачать Markdown
          </button>
        </div>
      </header>

      <aside className="contract-notice" aria-label="Статус API дайджеста">
        <strong>Клиентский снимок</strong>
        <p>
          Клиентский снимок по текущим данным. Серверное API и хранение версий дайджеста пока не предусмотрены.
        </p>
      </aside>

      {state.status === 'loading' && (
        <PageState
          kind="loading"
          title="Формируем дайджест"
          message="Загружаем все публикации, решения и официальные события НПА."
        />
      )}

      {state.status === 'error' && (
        <PageState
          kind="error"
          title="Дайджест не загрузился"
          message={state.message}
          action={(
            <button
              className="digest-button state-action"
              type="button"
              onClick={() => setRequestVersion((version) => version + 1)}
            >
              Повторить
            </button>
          )}
        />
      )}

      {state.status === 'success' && snapshot && <DigestContent snapshot={snapshot} />}
    </section>
  )
}

function DigestContent({ snapshot }: { snapshot: DigestSnapshot }) {
  const total = Object.values(snapshot.summary).reduce((sum, count) => sum + count, 0)

  return (
    <div className="digest-content">
      <div className="digest-metadata">
        <p><span>Сформирован</span><strong>{formatDate(snapshot.generated_at)}</strong></p>
        <p><span>Scope</span><strong>{snapshot.scope.kind}</strong></p>
        <p><span>Версия схемы</span><strong>{snapshot.schema_version}</strong></p>
      </div>

      <dl className="digest-counters" role="group" aria-label="Сводные счётчики">
        {counterItems.map((item) => (
          <div key={item.key}>
            <dt>{item.label}</dt>
            <dd>{snapshot.summary[item.key]}</dd>
          </div>
        ))}
      </dl>

      {total === 0 && (
        <PageState
          kind="empty"
          title="Дайджест пуст"
          message="В доступных данных нет элементов ни для одного раздела."
        />
      )}

      <section className="digest-section" aria-labelledby="digest-critical-heading">
        <DigestSectionHeading
          index="01"
          id="digest-critical-heading"
          title="Подтверждённые критические материалы"
          count={snapshot.critical_materials.length}
        />
        {snapshot.critical_materials.length === 0 ? (
          <SectionEmpty message="Нет подтверждённых актуальных решений с критическим приоритетом." />
        ) : (
          <div className="digest-card-grid">
            {snapshot.critical_materials.map((item) => (
              <article className="digest-card digest-card-critical" key={item.id}>
                <p className="digest-card-kicker">
                  {digestLabels.status[item.decision_status]} · {item.source_name}
                </p>
                <h3><Link to={item.publication_path}>{item.title}</Link></h3>
                <p>{item.summary}</p>
                <dl className="digest-card-details">
                  <div><dt>Категория</dt><dd>{digestLabels.category[item.category]}</dd></div>
                  <div><dt>Приоритет</dt><dd>{digestLabels.priority[item.priority]}</dd></div>
                  <div><dt>Автор</dt><dd>{item.author_id}</dd></div>
                  <div><dt>Решение</dt><dd>{formatDate(item.decided_at)}</dd></div>
                </dl>
                <DigestLinks internalPath={item.publication_path} originalUrl={item.original_url} />
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="digest-section" aria-labelledby="digest-lifecycle-heading">
        <DigestSectionHeading
          index="02"
          id="digest-lifecycle-heading"
          title="Изменения стадий НПА"
          count={snapshot.lifecycle_changes.length}
        />
        {snapshot.lifecycle_changes.length === 0 ? (
          <SectionEmpty message="Нет официально подтверждённых событий в timeline кейсов НПА." />
        ) : (
          <ol className="digest-timeline">
            {snapshot.lifecycle_changes.map((item) => (
              <li key={`${item.regulatory_case_id}:${item.id}`}>
                <article className="digest-card">
                  <p className="digest-card-kicker">{item.registration_number}</p>
                  <h3><Link to={item.case_path}>{item.case_title}</Link></h3>
                  <p className="digest-transition">
                    {item.from_stage === null
                      ? `Зафиксирована начальная стадия — ${digestLabels.stage[item.stage]}`
                      : `${digestLabels.stage[item.from_stage]} → ${digestLabels.stage[item.stage]}`}
                  </p>
                  <p>{item.comment ?? 'Комментарий не указан.'}</p>
                  <dl className="digest-card-details">
                    <div><dt>Фактическая дата</dt><dd>{formatDate(item.occurred_at)}</dd></div>
                    <div><dt>Подтверждение</dt><dd>{digestLabels.confirmationSource[item.confirmation_source_type]}</dd></div>
                    <div><dt>Автор</dt><dd>{item.author_id}</dd></div>
                  </dl>
                  <DigestLinks internalPath={item.case_path} originalUrl={item.confirmation_url} originalLabel="Официальное подтверждение" />
                </article>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="digest-section" aria-labelledby="digest-review-heading">
        <DigestSectionHeading
          index="03"
          id="digest-review-heading"
          title="Требующие проверки карточки"
          count={snapshot.review_queue.length}
        />
        {snapshot.review_queue.length === 0 ? (
          <SectionEmpty message="Нет новых версий AI-анализа, ожидающих решения специалиста." />
        ) : (
          <div className="digest-card-grid">
            {snapshot.review_queue.map((item) => (
              <article className="digest-card" key={item.id}>
                <p className="digest-card-kicker">{item.source_name} · {formatDate(item.published_at)}</p>
                <h3><Link to={item.publication_path}>{item.title}</Link></h3>
                <p>{item.summary}</p>
                <dl className="digest-card-details">
                  <div><dt>AI-категория</dt><dd>{digestLabels.category[item.category]}</dd></div>
                  <div><dt>AI-приоритет</dt><dd>{digestLabels.priority[item.proposed_priority]}</dd></div>
                  <div><dt>Uncertainty</dt><dd>{Math.round(item.uncertainty * 100)}%</dd></div>
                </dl>
                <DigestLinks internalPath={item.publication_path} originalUrl={item.original_url} />
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="digest-section" aria-labelledby="digest-actions-heading">
        <DigestSectionHeading
          index="04"
          id="digest-actions-heading"
          title="Действия пользователей"
          count={snapshot.user_actions.length}
        />
        {snapshot.user_actions.length === 0 ? (
          <SectionEmpty message="Нет сохранённых решений специалистов и lifecycle events." />
        ) : (
          <ol className="digest-action-list">
            {snapshot.user_actions.map((item) => (
              <li key={`${item.type}:${item.id}`}>
                {item.type === 'specialist_decision' ? (
                  <article>
                    <p className="digest-action-type">specialist_decision · {digestLabels.status[item.status]}</p>
                    <h3><Link to={item.publication_path}>{item.publication_title}</Link></h3>
                    <p>{item.comment ?? 'Комментарий не указан.'}</p>
                    <p className="digest-action-meta">
                      {digestLabels.category[item.final_category]} · {digestLabels.priority[item.final_priority]} · {item.author_id} · {formatDate(item.created_at)}
                    </p>
                  </article>
                ) : (
                  <article>
                    <p className="digest-action-type">lifecycle_event · {digestLabels.stage[item.stage]}</p>
                    <h3><Link to={item.case_path}>{item.case_title}</Link></h3>
                    <p>{item.comment ?? 'Комментарий не указан.'}</p>
                    <p className="digest-action-meta">
                      {digestLabels.confirmationSource[item.confirmation_source_type]} · {item.author_id} · создано {formatDate(item.created_at)} · событие {formatDate(item.occurred_at)}
                    </p>
                    <a className="digest-inline-link" href={item.confirmation_url} target="_blank" rel="noreferrer">
                      Официальный источник ↗
                    </a>
                  </article>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

function DigestSectionHeading({
  index,
  id,
  title,
  count,
}: {
  index: string
  id: string
  title: string
  count: number
}) {
  return (
    <header className="digest-section-heading">
      <span>{index}</span>
      <h2 id={id}>{title}</h2>
      <strong aria-label={`${title}: ${count}`}>{count}</strong>
    </header>
  )
}

function DigestLinks({
  internalPath,
  originalUrl,
  originalLabel = 'Открыть оригинал',
}: {
  internalPath: string
  originalUrl: string
  originalLabel?: string
}) {
  return (
    <div className="digest-card-links">
      <Link to={internalPath}>Открыть карточку →</Link>
      <a href={originalUrl} target="_blank" rel="noreferrer">{originalLabel} ↗</a>
    </div>
  )
}
