import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import type { PublicationDetail } from './api/types'
import {
  categoryColors,
  clampGraphView,
  initialGraphView,
  type GraphView,
} from './signalGraph'
import { useDialogFocus } from './useDialogFocus'
import { connectTelegramRuntime } from './telegram/adapter'
import { formatCategory } from './format'
const HeroVisual = lazy(() => import('./HeroVisual'))
class MapBoundary extends Component<
  { children: ReactNode; items: PublicationDetail[]; returnTo: string },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <div className="map-error">
        <p>Карта недоступна. Те же новости списком:</p>
        <ul>
          {this.props.items.slice(0, 50).map((i) => (
            <li key={i.publication.id}>
              <Link
                to={`/publications/${encodeURIComponent(i.publication.id)}`}
                state={{ returnTo: this.props.returnTo }}
              >
                {i.publication.title}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    ) : (
      this.props.children
    )
  }
}
export function SignalMap({
  items,
  sourceNames,
  total,
  highlighted,
  onHighlight,
  returnTo,
}: {
  items: PublicationDetail[]
  sourceNames: Record<string, string>
  total: number
  highlighted: string | null
  onHighlight: (id: string | null) => void
  returnTo: string
}) {
  const [open, setOpen] = useState(
    () =>
      typeof matchMedia === 'function' &&
      matchMedia('(min-width: 1100px)').matches,
  )
  const [expanded, setExpanded] = useState(false)
  const [paused, setPaused] = useState(false)
  const [view, setView] = useState<GraphView>(initialGraphView)
  const panelRef = useRef<HTMLElement>(null)
  const inlineHeight = useRef(500)
  const closeExpanded = useCallback(() => {
    setExpanded(false)
    requestAnimationFrame(() =>
      panelRef.current
        ?.querySelector<HTMLButtonElement>('.map-expand-button')
        ?.focus(),
    )
  }, [])
  useDialogFocus(expanded, panelRef, closeExpanded)
  useEffect(() => {
    if (!expanded) return
    const overflow = document.body.style.overflow
    const root = document.getElementById('root')
    const wasInert = root?.inert ?? false
    if (root) root.inert = true
    document.body.style.overflow = 'hidden'
    const disconnect = connectTelegramRuntime((webApp) => {
      const restoreSwipes = webApp.isVerticalSwipesEnabled !== false
      try {
        webApp.disableVerticalSwipes?.()
      } catch {
        /* older Telegram */
      }
      return () => {
        if (restoreSwipes) {
          try {
            webApp.enableVerticalSwipes?.()
          } catch {
            /* older Telegram */
          }
        }
      }
    })
    return () => {
      document.body.style.overflow = overflow
      if (root) root.inert = wasInert
      disconnect()
    }
  }, [expanded])
  const change = (update: Partial<GraphView>) =>
    setView((v) => clampGraphView({ ...v, ...update }))
  const panel = (
    <section
      ref={panelRef}
      className={`signal-map ${expanded ? 'map-fullscreen' : ''}`}
      role={expanded ? 'dialog' : undefined}
      aria-modal={expanded ? true : undefined}
      aria-label="Карта сигналов"
    >
      <div className="map-heading">
        <div>
          <p className="eyebrow">Интерактивный обзор</p>
          <h2>
            Карта сигналов <span className="map-dimension">3D</span>
          </h2>
        </div>
        <div className="map-heading-actions">
          {open && !expanded && (
            <button
              type="button"
              className="map-expand-button"
              aria-label="Развернуть карту на весь экран"
              title="На весь экран"
              onClick={() => {
                inlineHeight.current = panelRef.current?.clientHeight ?? 500
                setExpanded(true)
              }}
            >
              ⤢
            </button>
          )}
          <button
            type="button"
            aria-expanded={open}
            aria-controls="signal-map-body"
            aria-label={
              expanded
                ? 'Закрыть полноэкранную карту'
                : open
                  ? 'Свернуть карту'
                  : 'Раскрыть карту'
            }
            onClick={() => {
              if (expanded) closeExpanded()
              else setOpen(!open)
            }}
          >
            {expanded ? '×' : open ? '−' : '+'}
          </button>
        </div>
      </div>
      <p className="map-coverage">
        На карте {Math.min(items.length, 50)} из {total} найденных новостей
      </p>
      {open && (
        <div id="signal-map-body">
          <div className="map-controls">
            <div className="map-control-group">
              <button
                type="button"
                disabled={paused}
                onClick={() => change({ yaw: view.yaw - 0.3 })}
                aria-label="Повернуть карту влево"
              >
                ←
              </button>
              <button
                type="button"
                disabled={paused}
                onClick={() => change({ yaw: view.yaw + 0.3 })}
                aria-label="Повернуть карту вправо"
              >
                →
              </button>
            </div>
            <div className="map-control-group">
              <button
                type="button"
                disabled={paused || view.zoom <= 0.5}
                onClick={() => change({ zoom: view.zoom / 1.2 })}
                aria-label="Отдалить карту"
              >
                −
              </button>
              <output aria-label="Масштаб карты">
                {Math.round(view.zoom * 100)}%
              </output>
              <button
                type="button"
                disabled={paused || view.zoom >= 3}
                onClick={() => change({ zoom: view.zoom * 1.2 })}
                aria-label="Приблизить карту"
              >
                +
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setView(initialGraphView)
                onHighlight(null)
              }}
              aria-label="Сброс вида"
              title="Сброс вида"
            >
              ⟲
            </button>
            <button
              className="map-pause"
              type="button"
              aria-pressed={paused}
              onClick={() => setPaused((v) => !v)}
            >
              {paused ? 'Продолжить' : 'Пауза'}
            </button>
          </div>
          <MapBoundary items={items} returnTo={returnTo}>
            <Suspense
              fallback={<p className="map-loading">Загружаем карту…</p>}
            >
              <HeroVisual
                sourceNames={sourceNames}
                items={items}
                highlighted={highlighted}
                onHighlight={onHighlight}
                returnTo={returnTo}
                view={view}
                setView={setView}
                paused={paused}
              />
            </Suspense>
          </MapBoundary>
          <div className="map-legend">
            {Object.entries(categoryColors).map(([category, color]) => (
              <span key={category}>
                <i style={{ background: color }} />
                {formatCategory(category as keyof typeof categoryColors)}
              </span>
            ))}
          </div>
          <p className="map-footnote">
            Кольцо — высокий приоритет AI · ✓ — в отчёте
          </p>
        </div>
      )}
    </section>
  )
  return expanded ? (
    <>
      <div
        className="map-placeholder"
        style={{ height: inlineHeight.current }}
      />
      {createPortal(panel, document.body)}
    </>
  ) : (
    panel
  )
}
