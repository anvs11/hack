import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { PublicationDetail, Source } from './api/types'
import {
  captureItem,
  emptyDraft,
  parseDraft,
  type ReportDraft,
  type ReportItem,
} from './report'

export const dataEnvironment = import.meta.env.VITE_API_BASE_URL
  ? `api:${import.meta.env.VITE_API_BASE_URL}`
  : 'api:same-origin'
export type ReportState = {
  draft: ReportDraft
  warning: string
  recovery: string | null
}
export function createReportStore(
  key: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
) {
  let state: ReportState = { draft: emptyDraft(), warning: '', recovery: null }
  let blocked = false
  try {
    if (!storage) throw new Error('storage unavailable')
    const raw = storage.getItem(key)
    if (raw) {
      try {
        state.draft = parseDraft(raw)
      } catch {
        state.recovery = raw
        blocked = true
        state.warning =
          'Сохранённые данные повреждены или имеют другую версию. Оригинал сохранён. Новые изменения пока только в памяти; скачайте резервную копию.'
      }
    }
  } catch {
    state.warning =
      'Хранилище браузера недоступно. Черновик только в памяти — скачайте его перед закрытием.'
  }
  const listeners = new Set<() => void>()
  function update(transform: (draft: ReportDraft) => ReportDraft) {
    const draft = {
      ...transform(state.draft),
      updated_at: new Date().toISOString(),
    }
    let warning = state.warning
    if (!blocked) {
      try {
        if (!storage) throw new Error()
        storage.setItem(key, JSON.stringify(draft))
        warning = ''
      } catch {
        warning =
          'Не удалось сохранить в браузере. Изменения только в памяти — скачайте отчёт перед закрытием.'
      }
    }
    state = { ...state, draft, warning }
    listeners.forEach((l) => l())
  }
  return {
    getSnapshot: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    edit: (patch: Partial<Pick<ReportDraft, 'title' | 'summary'>>) =>
      update((d) => ({ ...d, ...patch })),
    add: (entries: { detail: PublicationDetail; source?: Source }[]) =>
      update((d) => {
        const ids = new Set(d.items.map((i) => i.id))
        const added = entries.filter((e) => {
          const id = e.detail.publication.id
          if (ids.has(id)) return false
          ids.add(id)
          return true
        })
        return {
          ...d,
          items: [
            ...d.items,
            ...added.map((e) => captureItem(e.detail, e.source)),
          ],
        }
      }),
    remove: (id: string) =>
      update((d) => ({ ...d, items: d.items.filter((i) => i.id !== id) })),
    comment: (id: string, comment: string) =>
      update((d) => ({
        ...d,
        items: d.items.map((i) => (i.id === id ? { ...i, comment } : i)),
      })),
    move: (id: string, direction: -1 | 1) =>
      update((d) => {
        const items = [...d.items]
        const index = items.findIndex((i) => i.id === id)
        const target = index + direction
        if (index >= 0 && target >= 0 && target < items.length)
          [items[index], items[target]] = [items[target], items[index]]
        return { ...d, items }
      }),
    refresh: (id: string, detail: PublicationDetail, source?: Source) =>
      update((d) => ({
        ...d,
        items: d.items.map((i): ReportItem => {
          if (i.id !== id) return i
          const captured = captureItem(detail, source)
          return {
            ...captured,
            source:
              captured.source ??
              (i.source?.id === detail.publication.source_id ? i.source : null),
            comment: i.comment,
          }
        }),
      })),
  }
}
type Store = ReturnType<typeof createReportStore>
const ReportContext = createContext<Store | null>(null)
function actorScope() {
  const ds = document.documentElement.dataset
  if (ds.telegramAuth === 'authenticated' && ds.telegramUserId)
    return `telegram:${ds.telegramUserId}`
  if (ds.telegramAuth === 'checking' || ds.telegramAuth === 'rejected')
    return 'telegram:unverified'
  return 'browser:local'
}
export function ReportProvider({ children }: { children: ReactNode }) {
  const [actor, setActor] = useState(actorScope)
  useEffect(() => {
    const observer = new MutationObserver(() => setActor(actorScope()))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-telegram-auth', 'data-telegram-user-id'],
    })
    setActor(actorScope())
    return () => observer.disconnect()
  }, [])
  const store = useMemo(() => {
    let storage: Storage | null = null
    try {
      storage = window.localStorage
    } catch {
      /* memory fallback */
    }
    return createReportStore(
      `regradar:report:v1:${encodeURIComponent(dataEnvironment)}:${actor}`,
      storage,
    )
  }, [actor])
  return (
    <ReportContext.Provider value={store}>{children}</ReportContext.Provider>
  )
}
export function useReport() {
  const store = useContext(ReportContext)
  if (!store) throw new Error('ReportProvider required')
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return { ...state, ...store }
}
export function ReportButton({
  detail,
  source,
}: {
  detail: PublicationDetail
  source?: Source
}) {
  const report = useReport()
  const included = report.draft.items.some(
    (i) => i.id === detail.publication.id,
  )
  return (
    <button
      type="button"
      className={`report-button ${included ? 'included' : ''}`}
      aria-pressed={included}
      onClick={() =>
        included
          ? report.remove(detail.publication.id)
          : report.add([{ detail, source }])
      }
    >
      <span aria-hidden="true">{included ? '✓' : '+'}</span>{' '}
      {included ? 'В отчёте' : 'В отчёт'}
    </button>
  )
}
