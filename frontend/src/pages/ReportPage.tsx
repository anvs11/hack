import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { DigestPage } from './DigestPage'
import { useReport } from '../shared/ReportStore'
import { api } from '../shared/api/client'
import type { PublicationDetail } from '../shared/api/types'
import { useApiResource } from '../shared/api/useApiResource'
import { downloadDigest } from '../shared/digest'
import {
  decisionStatus,
  reportJson,
  reportMarkdown,
  safeUrl,
  snapshotChanged,
  type ReportDraft,
  type ReportItem,
} from '../shared/report'
import { formatCategory, formatDate, formatPriority } from '../shared/format'
import { sourceTypeLabel } from '../shared/feedQuery'
import { PageState } from '../shared/PageState'

export function ReportPage() {
  const [params] = useSearchParams()
  const automatic = params.get('tab') === 'auto'
  return (
    <section>
      <nav className="report-tabs" aria-label="Режим отчёта">
        <Link to="/digest" aria-current={!automatic ? 'page' : undefined}>
          Мой отчёт
        </Link>
        <Link
          to="/digest?tab=auto"
          aria-current={automatic ? 'page' : undefined}
        >
          Автоматическая сводка
        </Link>
      </nav>
      {automatic ? <DigestPage /> : <ManualReport />}
    </section>
  )
}
type FreshState =
  | { status: 'checking' }
  | { status: 'available'; detail: PublicationDetail }
  | { status: 'unavailable'; message: string }
function ManualReport() {
  const report = useReport()
  const [params] = useSearchParams()
  const preview = ['preview', 'print'].includes(params.get('view') ?? '')
  const [fresh, setFresh] = useState<Record<string, FreshState>>({})
  const [checkVersion, setCheckVersion] = useState(0)
  const [notice, setNotice] = useState('')
  const sourceState = useApiResource(
    useCallback((signal: AbortSignal) => api.listSources(signal), []),
  )
  const ids = report.draft.items.map((i) => i.id).join('\u0000')
  useEffect(() => {
    const controller = new AbortController()
    const queue = ids ? ids.split('\u0000') : []
    setFresh(
      Object.fromEntries(queue.map((id) => [id, { status: 'checking' }])),
    )
    let index = 0
    async function worker() {
      while (index < queue.length && !controller.signal.aborted) {
        const id = queue[index++]
        try {
          const detail = await api.getPublication(id, controller.signal)
          if (!controller.signal.aborted)
            setFresh((current) => ({
              ...current,
              [id]: { status: 'available', detail },
            }))
        } catch {
          if (!controller.signal.aborted)
            setFresh((current) => ({
              ...current,
              [id]: {
                status: 'unavailable',
                message:
                  'Материал сейчас недоступен. Сохранённый снимок остаётся в отчёте.',
              },
            }))
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker))
    return () => controller.abort()
  }, [ids, checkVersion])
  function download(kind: 'md' | 'json') {
    const filename = `RegRadar-report-${new Date().toISOString().slice(0, 10)}.${kind}`
    downloadDigest(
      kind === 'md' ? reportMarkdown(report.draft) : reportJson(report.draft),
      filename,
      kind === 'md'
        ? 'text/markdown;charset=utf-8'
        : 'application/json;charset=utf-8',
    )
    setNotice(`Скачан отчёт: ${report.draft.items.length} материалов.`)
  }
  if (preview)
    return (
      <>
        <div className="print-toolbar">
          <Link className="back-link" to="/digest">
            ← К редактированию отчёта
          </Link>
          <button className="primary-action" onClick={() => window.print()}>
            Печать / сохранить PDF
          </button>
        </div>
        <ReportPreview draft={report.draft} />
      </>
    )
  return (
    <>
      <header className="workspace-heading">
        <div>
          <p className="eyebrow">Подготовка обзора</p>
          <h1>Отчёт для руководителя</h1>
        </div>
        <Link to="/feed">+ Добавить материалы</Link>
      </header>
      {notice && (
        <p className="action-message" role="status">
          {notice}
        </p>
      )}
      <div className="report-layout">
        <div className="report-editor">
          <section className="report-settings" aria-label="Параметры отчёта">
            <label className="form-field">
              <span>Название отчёта</span>
              <input
                value={report.draft.title}
                maxLength={200}
                onChange={(e) => report.edit({ title: e.target.value })}
              />
            </label>
            <label className="form-field">
              <span>Краткое резюме отчёта</span>
              <textarea
                rows={3}
                placeholder="Что руководителю нужно знать об этой подборке?"
                value={report.draft.summary}
                onChange={(e) => report.edit({ summary: e.target.value })}
              />
            </label>
            <p className="report-description">
              Ваши комментарии и резюме не меняют решение специалиста.
            </p>
          </section>
          <div className="results-toolbar">
            <strong>Материалы отчёта · {report.draft.items.length}</strong>
            <button
              type="button"
              disabled={
                !report.draft.items.length ||
                Object.values(fresh).some((f) => f.status === 'checking')
              }
              onClick={() => setCheckVersion((v) => v + 1)}
            >
              Проверить обновления
            </button>
          </div>
          {report.draft.items.length === 0 && (
            <PageState
              kind="empty"
              title="Соберите первый отчёт"
              message="Добавьте публикации из мониторинга или из открытого анализа."
              action={
                <Link className="button-link" to="/feed">
                  К публикациям →
                </Link>
              }
            />
          )}
          {report.draft.items.map((item, index) => {
            const { publication: p, latest_analysis: a } = item.detail
            const current = fresh[item.id]
            return (
              <article
                className="report-item"
                key={item.id}
                aria-label={`Материал отчёта: ${p.title}`}
              >
                <div className="report-item-heading">
                  <span className="report-order">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <h2>
                      <Link
                        to={`/publications/${encodeURIComponent(p.id)}`}
                        state={{ returnTo: '/digest' }}
                      >
                        {p.title}
                      </Link>
                    </h2>
                    <div className="card-meta">
                      <span>{item.source?.name ?? p.source_id}</span>
                      <span>{formatDate(p.published_at)}</span>
                    </div>
                  </div>
                </div>
                <p className="card-summary">
                  {!a && <strong>Фрагмент исходного материала: </strong>}
                  {a?.summary ?? p.content.slice(0, 320)}
                </p>
                <SnapshotStatus item={item} />
                {current?.status === 'checking' && (
                  <p className="report-save-note">
                    Проверяем доступность и версии…
                  </p>
                )}
                {current?.status === 'unavailable' && (
                  <p className="snapshot-notice">{current.message}</p>
                )}
                {current?.status === 'available' &&
                  snapshotChanged(item, current.detail) && (
                    <div className="snapshot-notice">
                      Доступны изменения: анализ, решение или метаданные. В
                      отчёте сохранена прежняя версия.
                      <button
                        type="button"
                        onClick={() => {
                          report.refresh(
                            item.id,
                            current.detail,
                            sourceState.data?.find(
                              (s) =>
                                s.id === current.detail.publication.source_id,
                            ),
                          )
                          setNotice(
                            'Снимок обновлён. Комментарий для менеджера сохранён.',
                          )
                        }}
                      >
                        Обновить снимок
                      </button>
                    </div>
                  )}
                <label className="form-field">
                  <span>Комментарий для менеджера</span>
                  <textarea
                    rows={2}
                    value={item.comment}
                    onChange={(e) => report.comment(item.id, e.target.value)}
                    placeholder="Контекст и ваши замечания к материалу"
                  />
                </label>
                <div className="report-item-footer">
                  <small>
                    AI {a ? `v${a.version}` : 'нет'} · решение{' '}
                    {item.detail.latest_decision
                      ? `v${item.detail.latest_decision.version}`
                      : 'не принято'}
                    <br />
                    Снимок: {formatDate(item.captured_at)}
                  </small>
                  <div>
                    <button
                      aria-label={`Выше: ${p.title}`}
                      disabled={index === 0}
                      onClick={() => report.move(item.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      aria-label={`Ниже: ${p.title}`}
                      disabled={index === report.draft.items.length - 1}
                      onClick={() => report.move(item.id, 1)}
                    >
                      ↓
                    </button>
                    <button onClick={() => report.remove(item.id)}>
                      Удалить
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
        <aside className="report-tools">
          <h2>Ваш отчёт</h2>
          <div>
            <p className="export-count">{report.draft.items.length}</p>
            <p>материалов в подборке</p>
          </div>
          <hr />
          <Link className="report-open" to="/digest?view=preview">
            Просмотр <span aria-hidden="true">↗</span>
          </Link>
          <button
            disabled={!report.draft.items.length}
            onClick={() => download('md')}
          >
            Скачать Markdown <span aria-hidden="true">↓</span>
          </button>
          <button
            disabled={!report.draft.items.length}
            onClick={() => download('json')}
          >
            Скачать JSON <span aria-hidden="true">↓</span>
          </button>
          <Link className="report-open" to="/digest?view=print">
            Печатный вид / PDF <span aria-hidden="true">↗</span>
          </Link>
          <hr />
          <p className="report-save-note">
            {report.warning
              ? 'Сохранение в браузере недоступно'
              : 'Черновик сохранён в этом браузере'}
          </p>
          <p>Экспорт включает выбранные версии и статусы проверки.</p>
          {report.recovery !== null && (
            <button
              onClick={() =>
                downloadDigest(
                  report.recovery!,
                  'RegRadar-storage-recovery.txt',
                  'text/plain;charset=utf-8',
                )
              }
            >
              Скачать резервную копию хранилища
            </button>
          )}
        </aside>
      </div>
    </>
  )
}
function SnapshotStatus({ item }: { item: ReportItem }) {
  const a = item.detail.latest_analysis
  const d = item.detail.latest_decision
  return (
    <>
      <div className="tag-row">
        <span className="tag">{formatCategory(a?.category ?? 'unknown')}</span>
        <span
          className={`priority priority-${a?.proposed_priority ?? 'unknown'}`}
        >
          AI-приоритет · {formatPriority(a?.proposed_priority ?? 'unknown')}
        </span>
        <span className="score">
          Важность:{' '}
          {a?.importance_score == null
            ? 'Нет данных'
            : `${a.importance_score} / 18`}
        </span>
      </div>
      <p className="decision-line">
        <span>{decisionStatus(item.detail)}</span>
        <span>
          {a
            ? a.needs_review
              ? 'AI требует проверки'
              : 'AI не запрашивает проверку'
            : 'Нет AI-анализа'}
        </span>
        {item.detail.publication.is_hidden && <span>Скрытая публикация</span>}
        {item.detail.publication.is_demo && (
          <span>Демонстрационные данные</span>
        )}
      </p>
      {d && (
        <p className="preview-version">
          {d.analysis_id === a?.id
            ? 'Финальный приоритет'
            : 'Приоритет предыдущего решения'}
          : {formatPriority(d.final_priority)} ·{' '}
          {formatCategory(d.final_category)}
        </p>
      )}
    </>
  )
}
export function ReportPreview({ draft }: { draft: ReportDraft }) {
  return (
    <section className="report-preview" aria-label="Предпросмотр отчёта">
      <div className="print-brand">◉ RegRadar</div>
      <p className="eyebrow">
        Обзор публикаций · {draft.items.length} материалов
      </p>
      <h1>{draft.title || 'Отчёт без названия'}</h1>
      <p className="preview-version">
        Обновлён: {formatDate(draft.updated_at)} · Статусы на момент сохранения
        снимков
      </p>
      <p className="preview-summary">
        {draft.summary || 'Резюме не добавлено.'}
      </p>
      {draft.items.map((item, index) => {
        const {
          publication: p,
          latest_analysis: a,
          latest_decision: d,
        } = item.detail
        return (
          <article key={item.id}>
            <h2>
              {index + 1}. {p.title}
            </h2>
            <div className="preview-meta">
              <span>{item.source?.name ?? p.source_id}</span>
              <span>{sourceTypeLabel(item.source?.type)}</span>
              <span>{formatDate(p.published_at)}</span>
            </div>
            <p>
              <a
                href={safeUrl(p.original_url)}
                target="_blank"
                rel="noreferrer"
              >
                {p.original_url}
              </a>
            </p>
            <p>
              <strong>
                {a
                  ? 'AI-саммари'
                  : 'Фрагмент исходного материала (анализа нет)'}
              </strong>
              <br />
              {a?.summary ?? p.content.slice(0, 500)}
            </p>
            <SnapshotStatus item={item} />
            {a && (
              <p className="preview-version">
                Неопределённость: {Math.round(a.uncertainty * 100)}%
              </p>
            )}
            {d && (
              <p>
                <strong>
                  {d.analysis_id === a?.id
                    ? 'Решение специалиста'
                    : 'Решение по предыдущей версии'}
                </strong>
                <br />
                {d.final_summary ?? 'Отдельное саммари специалиста не указано.'}
                <br />
                {d.comment ?? 'Комментарий специалиста не указан.'} ·{' '}
                {d.author_id}
              </p>
            )}
            {a?.evidence.map((ev, i) => (
              <blockquote key={i}>
                <strong>{ev.claim}</strong>
                <br />«{ev.quote}»
              </blockquote>
            ))}
            {p.tags.length > 0 && (
              <p className="preview-version">Теги: {p.tags.join(', ')}</p>
            )}
            {item.comment && (
              <div className="preview-comment">
                <strong>Комментарий для менеджера</strong>
                <br />
                {item.comment}
              </div>
            )}
            <p className="preview-version">
              Снимок: {formatDate(item.captured_at)} · AI:{' '}
              {a ? `${a.id} / v${a.version}` : 'нет'} · Решение:{' '}
              {d ? `${d.id} / v${d.version}` : 'нет'}
            </p>
          </article>
        )
      })}
    </section>
  )
}
