import {
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import { ApiError, api } from '../shared/api/client'
import type {
  CollectionReport,
  Source,
  SourceCreate,
  SourcePatch,
  SourceType,
} from '../shared/api/types'
import { formatDate } from '../shared/format'
import { PageState } from '../shared/PageState'
import { RevealText } from '../shared/RevealText'

const sourceTypes: SourceType[] = [
  'rss',
  'regulator',
  'telegram',
  'telegram_archive',
  'file',
  'seed',
]

const sourceTypeLabels: Record<SourceType, string> = {
  rss: 'RSS-лента',
  regulator: 'Сайт регулятора',
  telegram: 'Telegram-канал',
  telegram_archive: 'Архив Telegram',
  file: 'Файл',
  seed: 'Demo seed',
}

const sourceTypeIcons: Record<SourceType, string> = {
  rss: 'R',
  regulator: '§',
  telegram: 'T',
  telegram_archive: 'TA',
  file: 'F',
  seed: 'S',
}

type LoadState =
  | { status: 'loading'; data: Source[]; error: null }
  | { status: 'success'; data: Source[]; error: null }
  | { status: 'error'; data: Source[]; error: Error }

type CardActionState = {
  pending?: 'toggle' | 'collect'
  error?: string
  report?: CollectionReport
}

export function SourcesPage() {
  const [state, setState] = useState<LoadState>({
    status: 'loading',
    data: [],
    error: null,
  })
  const [actionStatus, setActionStatus] = useState('')
  const [cardActions, setCardActions] = useState<Record<string, CardActionState>>({})
  const loadVersionRef = useRef(0)
  const pendingActionsRef = useRef(new Set<string>())

  useEffect(() => {
    const controller = new AbortController()
    const version = ++loadVersionRef.current
    api.listSources(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted && version === loadVersionRef.current) {
          setState({ status: 'success', data, error: null })
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted && version === loadVersionRef.current) {
          setState({
            status: 'error',
            data: [],
            error: error instanceof Error ? error : new Error('Неизвестная ошибка'),
          })
        }
      },
    )
    return () => controller.abort()
  }, [])

  function updateCardAction(sourceId: string, next: Partial<CardActionState>) {
    setCardActions((current) => ({
      ...current,
      [sourceId]: { ...current[sourceId], ...next },
    }))
  }

  function acceptSource(source: Source) {
    loadVersionRef.current += 1
    setState((current) => ({
      status: 'success',
      data: current.data.some((item) => item.id === source.id)
        ? current.data.map((item) => item.id === source.id ? source : item)
        : [...current.data, source],
      error: null,
    }))
  }

  async function refreshSources() {
    const version = ++loadVersionRef.current
    const data = await api.listSources()
    if (version === loadVersionRef.current) {
      setState({ status: 'success', data, error: null })
    }
  }

  async function handleToggle(source: Source) {
    const actionKey = `${source.id}:toggle`
    if (pendingActionsRef.current.has(actionKey)) return
    pendingActionsRef.current.add(actionKey)
    updateCardAction(source.id, { pending: 'toggle', error: '' })
    setActionStatus('')

    try {
      const updated = await api.updateSource(source.id, { enabled: !source.enabled })
      acceptSource(updated)
      setActionStatus(updated.enabled
        ? `Источник «${updated.name}» включён.`
        : `Источник «${updated.name}» поставлен на паузу.`)
    } catch (error) {
      updateCardAction(source.id, { error: await sourceMutationError(error, refreshSources) })
    } finally {
      pendingActionsRef.current.delete(actionKey)
      updateCardAction(source.id, { pending: undefined })
    }
  }

  async function handleCollect(source: Source) {
    const actionKey = `${source.id}:collect`
    if (pendingActionsRef.current.has(actionKey)) return
    pendingActionsRef.current.add(actionKey)
    updateCardAction(source.id, { pending: 'collect', error: '', report: undefined })
    setActionStatus('')

    try {
      const report = await api.collectSource(source.id)
      updateCardAction(source.id, { report })
      try {
        await refreshSources()
      } catch (refreshError) {
        updateCardAction(source.id, {
          error: refreshError instanceof Error
            ? `Сбор завершён, но статус источника не обновился: ${refreshError.message}`
            : 'Сбор завершён, но статус источника не обновился.',
        })
      }
    } catch (error) {
      updateCardAction(source.id, { error: await sourceMutationError(error, refreshSources) })
    } finally {
      pendingActionsRef.current.delete(actionKey)
      updateCardAction(source.id, { pending: undefined })
    }
  }

  const activeCount = state.data.filter((source) => source.enabled).length

  return (
    <section>
      <header className="page-heading sources-heading">
        <div>
          <p className="eyebrow">Контур сбора</p>
          <RevealText lines={['Источники']} />
          <p className="page-description">
            Управляйте точками наблюдения, их статусом и ручным сбором.
          </p>
        </div>
        <div className="sources-heading-actions">
          <SourceDialogTrigger
            mode="create"
            onSaved={(source) => {
              acceptSource(source)
              setActionStatus(`Источник «${source.name}» добавлен.`)
            }}
            onMissing={refreshSources}
          />
          <div className="metric-card"><strong>{activeCount}</strong><span>активных</span></div>
        </div>
      </header>

      {actionStatus && <p className="action-message" role="status">{actionStatus}</p>}

      {state.status === 'loading' ? (
        <PageState kind="loading" title="Загружаем источники" message="Проверяем состояние подключений." />
      ) : state.status === 'error' ? (
        <PageState kind="error" title="Источники не загрузились" message={state.error.message} />
      ) : state.data.length === 0 ? (
        <PageState kind="empty" title="Источников нет" message="Добавьте первую точку наблюдения." />
      ) : (
        <div className="source-list">
          {state.data.map((source, index) => {
            const action = cardActions[source.id] ?? {}
            return (
              <article className="source-card" key={source.id}>
                <div className="source-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</div>
                <div className="source-icon" aria-hidden="true">{sourceTypeIcons[source.type]}</div>
                <div className="source-main">
                  <div className="source-title-row">
                    <div>
                      <div className="source-badges">
                        <span className={`source-status ${source.enabled ? 'enabled' : 'disabled'}`}>
                          {source.enabled ? 'Активен' : 'Пауза'}
                        </span>
                        {source.is_demo && <span className="demo-badge">Demo</span>}
                      </div>
                      <h2>{source.name}</h2>
                    </div>
                  </div>
                  <p className="source-identity">{source.id} · {sourceTypeLabels[source.type]}</p>
                  <a className="source-url" href={source.url} target="_blank" rel="noreferrer">
                    {source.url} <span aria-hidden="true">↗</span>
                  </a>
                  <dl className="source-health">
                    <div>
                      <dt>Последняя проверка</dt>
                      <dd>{source.last_checked_at ? formatDate(source.last_checked_at) : 'Ещё не запускался'}</dd>
                    </div>
                    <div>
                      <dt>Последнее успешное обновление</dt>
                      <dd>{source.last_success_at ? formatDate(source.last_success_at) : 'Успешных обновлений ещё не было'}</dd>
                    </div>
                    <div>
                      <dt>Последняя ошибка</dt>
                      <dd className={source.last_error ? 'error-text' : undefined}>
                        {source.last_error ?? 'Ошибок нет'}
                      </dd>
                    </div>
                  </dl>
                  <div className="source-actions">
                    <SourceDialogTrigger
                      mode="edit"
                      source={source}
                      disabled={Boolean(action.pending)}
                      onSaved={(updated) => {
                        acceptSource(updated)
                        setActionStatus(`Источник «${updated.name}» обновлён.`)
                      }}
                      onMissing={refreshSources}
                    />
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={Boolean(action.pending)}
                      onClick={() => handleToggle(source)}
                    >
                      {action.pending === 'toggle'
                        ? source.enabled ? 'Отключаем…' : 'Включаем…'
                        : source.enabled ? 'Отключить' : 'Включить'}
                    </button>
                    <button
                      type="button"
                      className="primary-action"
                      disabled={Boolean(action.pending)}
                      onClick={() => handleCollect(source)}
                    >
                      {action.pending === 'collect' ? 'Запускаем…' : 'Запустить сбор'}
                    </button>
                  </div>
                  {action.error && <p className="form-error source-action-message" role="alert">{action.error}</p>}
                  {action.report && <CollectionResult report={action.report} sourceId={source.id} />}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function SourceDialogTrigger({
  mode,
  source,
  disabled = false,
  onSaved,
  onMissing,
}: {
  mode: 'create' | 'edit'
  source?: Source
  disabled?: boolean
  onSaved: (source: Source) => void
  onMissing: () => Promise<void>
}) {
  const [isOpen, setIsOpen] = useState(false)
  const openerRef = useRef<HTMLButtonElement>(null)

  function close() {
    setIsOpen(false)
    window.setTimeout(() => openerRef.current?.focus(), 0)
  }

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        className={mode === 'create' ? 'primary-action add-source-action' : 'secondary-action'}
        disabled={disabled}
        onClick={() => setIsOpen(true)}
      >
        {mode === 'create' ? 'Добавить источник' : 'Редактировать'}
      </button>
      {isOpen && (
        <SourceFormDialog
          mode={mode}
          source={source}
          onClose={close}
          onSaved={(saved) => {
            onSaved(saved)
            close()
          }}
          onMissing={onMissing}
        />
      )}
    </>
  )
}

function SourceFormDialog({
  mode,
  source,
  onClose,
  onSaved,
  onMissing,
}: {
  mode: 'create' | 'edit'
  source?: Source
  onClose: () => void
  onSaved: (source: Source) => void
  onMissing: () => Promise<void>
}) {
  const [name, setName] = useState(source?.name ?? '')
  const [type, setType] = useState<SourceType>(source?.type ?? 'rss')
  const [url, setUrl] = useState(source?.url ?? '')
  const [enabled, setEnabled] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const submitGuardRef = useRef(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const titleId = mode === 'create' ? 'create-source-title' : `edit-source-title-${source?.id}`
  const trimmedName = name.trim()
  const hasChanges = mode === 'create' || (source !== undefined && (
    trimmedName !== source.name || url !== source.url
  ))

  useEffect(() => {
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable.at(-1)!
      const focusIsOutside = !dialogRef.current.contains(document.activeElement)
      if (event.shiftKey && (document.activeElement === first || focusIsOutside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || focusIsOutside)) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitGuardRef.current || !hasChanges) return
    submitGuardRef.current = true
    setIsSubmitting(true)
    setError('')

    try {
      if (mode === 'create') {
        const payload: SourceCreate = { name: trimmedName, type, url, enabled }
        onSaved(await api.createSource(payload))
      } else if (source) {
        const patch: SourcePatch = {}
        if (trimmedName !== source.name) patch.name = trimmedName
        if (url !== source.url) patch.url = url
        if (Object.keys(patch).length === 0) return
        onSaved(await api.updateSource(source.id, patch))
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        try {
          await onMissing()
        } catch {
          // The actionable 404 remains the primary error shown in the dialog.
        }
      }
      setError(sourceFormError(caught))
    } finally {
      submitGuardRef.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section
        ref={dialogRef}
        className="case-dialog source-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">{mode === 'create' ? 'Новая точка наблюдения' : source?.id}</p>
            <h2 id={titleId}>{mode === 'create' ? 'Добавить источник' : 'Редактировать источник'}</h2>
          </div>
          <button ref={closeRef} type="button" className="dialog-close" onClick={onClose} aria-label="Закрыть диалог">×</button>
        </div>
        <form className="source-form" onSubmit={submit}>
          <label className="form-field">
            <span>Название</span>
            <input required value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          {mode === 'create' ? (
            <label className="form-field">
              <span>Тип</span>
              <select value={type} onChange={(event) => setType(event.target.value as SourceType)}>
                {sourceTypes.map((value) => <option key={value} value={value}>{sourceTypeLabels[value]}</option>)}
              </select>
            </label>
          ) : (
            <div className="form-field source-readonly-type">
              <span>Тип</span>
              <strong>{source ? sourceTypeLabels[source.type] : ''}</strong>
              <small className="form-help">Тип источника нельзя изменить.</small>
            </div>
          )}
          <label className="form-field form-field-wide">
            <span>URL</span>
            <input type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.org/feed" />
          </label>
          {mode === 'create' && (
            <label className="source-checkbox form-field-wide">
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
              <span>Включить сразу</span>
            </label>
          )}
          {error && <p className="form-error form-field-wide" role="alert">{error}</p>}
          <div className="dialog-actions form-field-wide">
            <button type="button" className="secondary-action" onClick={onClose}>Отмена</button>
            <button type="submit" className="primary-action" disabled={isSubmitting || !hasChanges}>
              {isSubmitting ? 'Сохраняем…' : mode === 'create' ? 'Добавить' : 'Сохранить'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function CollectionResult({ report, sourceId }: { report: CollectionReport; sourceId: string }) {
  const result = report.sources.find((item) => item.source_id === sourceId) ?? report.sources[0]
  const isSuccessful = report.status === 'completed' && result?.status === 'success'

  return (
    <section
      className={`collection-result ${isSuccessful ? 'success' : 'warning'}`}
      role={isSuccessful ? 'status' : 'alert'}
      aria-label="Результат сбора"
    >
      <div className="collection-result-heading">
        <strong>Сбор завершён</strong>
        <span>Статус · {report.status}</span>
      </div>
      <dl>
        <div><dt>Collected</dt><dd>{report.collected}</dd></div>
        <div><dt>Created</dt><dd>{report.created}</dd></div>
        <div><dt>Exact duplicates</dt><dd>{report.exact_duplicates}</dd></div>
        <div><dt>Semantic candidates</dt><dd>{report.semantic_candidates}</dd></div>
      </dl>
      {result?.error && <p className="error-text">{result.error}</p>}
    </section>
  )
}

async function sourceMutationError(error: unknown, refresh: () => Promise<void>) {
  if (error instanceof ApiError && error.status === 404) {
    try {
      await refresh()
      return 'Источник больше не существует. Список обновлён.'
    } catch {
      return 'Источник больше не существует. Не удалось обновить список.'
    }
  }
  return error instanceof Error ? error.message : 'Не удалось выполнить действие'
}

function sourceFormError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return 'Источник больше не существует. Список источников обновлён.'
    }
    if (error.status === 422) {
      return `Проверьте поля. ${error.message} Введённые значения сохранены.`
    }
  }
  return error instanceof Error ? error.message : 'Не удалось сохранить источник'
}
