import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { Link } from 'react-router-dom'
import type { PublicationDetail } from './api/types'
import {
  categoryColors,
  buildGraph,
  project,
  type GraphView,
} from './signalGraph'
import { useGraphControls } from './useGraphControls'
import { formatDate, formatPriority } from './format'
import { useReport } from './ReportStore'

// Retains the original lightweight WebGL point-sphere technique. Geometry is
// publication-derived; the scene renders on demand, with no permanent RAF loop.
const vertexShader = `attribute vec3 aPosition; attribute vec3 aColor; attribute float aSize;
uniform float uRatio; varying vec3 vColor;
void main(){gl_Position=vec4(aPosition.xy,0.0,1.0);gl_PointSize=aSize*uRatio;vColor=aColor;}`
const fragmentShader = `precision mediump float; varying vec3 vColor;
void main(){vec2 p=gl_PointCoord*2.0-1.0;float r=length(p);if(r>1.0)discard;
float core=1.0-smoothstep(.12,.3,r);float glow=exp(-3.5*r)*.85*(1.0-r);
vec3 color=mix(vColor,vec3(1.0),core*.78);
gl_FragColor=vec4(color,max(core,glow));}`
export type MapProps = {
  sourceNames: Record<string, string>
  items: PublicationDetail[]
  highlighted: string | null
  onHighlight: (id: string | null) => void
  returnTo: string
  paused: boolean
  view: GraphView
  setView: Dispatch<SetStateAction<GraphView>>
}
export default function HeroVisual({
  items,
  sourceNames,
  highlighted,
  onHighlight,
  returnTo,
  paused,
  view,
  setView,
}: MapProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [aspect, setAspect] = useState(1)
  const controls = useGraphControls(stageRef, paused, setView)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef<(() => void) | null>(null)
  const [fallback, setFallback] = useState(false)
  const [edgeIndex, setEdgeIndex] = useState('')
  const [inspectedId, setInspectedId] = useState<string | null>(null)
  const report = useReport()
  const [includeSources, setIncludeSources] = useState(true)
  const graph = useMemo(
    () => buildGraph(items, includeSources, sourceNames),
    [items, includeSources, sourceNames],
  )
  const projected = graph.nodes
    .map((n) => ({ ...n, ...project(n.position, view, aspect) }))
    .sort((a, b) => b.depth - a.depth)
  const sceneRef = useRef(projected)
  sceneRef.current = projected
  const pointById = new Map(projected.map((n) => [n.id, n]))
  const selected = items.find(
    (i) => i.publication.id === (highlighted ?? inspectedId),
  )
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const measure = () => {
      const r = stage.getBoundingClientRect()
      if (r.height) setAspect(r.width / r.height)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])
  useEffect(() => setEdgeIndex(''), [items, includeSources])
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let gl: WebGLRenderingContext | null = null
    try {
      if (typeof WebGLRenderingContext !== 'undefined')
        gl = canvas.getContext('webgl', {
          alpha: true,
          antialias: true,
          powerPreference: 'low-power',
        })
    } catch {
      /* use 2D */
    }
    if (!gl) {
      setFallback(true)
      return
    }
    const ctx = gl
    const shaders: WebGLShader[] = []
    const buffers: WebGLBuffer[] = []
    const program = ctx.createProgram()
    const cleanup = () => {
      buffers.forEach((b) => ctx.deleteBuffer(b))
      shaders.forEach((s) => ctx.deleteShader(s))
      if (program) ctx.deleteProgram(program)
    }
    try {
      if (!program) throw new Error('No program')
      for (const [type, source] of [
        [ctx.VERTEX_SHADER, vertexShader],
        [ctx.FRAGMENT_SHADER, fragmentShader],
      ] as const) {
        const shader = ctx.createShader(type)
        if (!shader) throw new Error('No shader')
        shaders.push(shader)
        ctx.shaderSource(shader, source)
        ctx.compileShader(shader)
        if (!ctx.getShaderParameter(shader, ctx.COMPILE_STATUS))
          throw new Error('Shader compilation failed')
        ctx.attachShader(program, shader)
      }
      ctx.linkProgram(program)
      if (!ctx.getProgramParameter(program, ctx.LINK_STATUS))
        throw new Error('Link failed')
      ctx.useProgram(program)
      for (let i = 0; i < 3; i++) {
        const buffer = ctx.createBuffer()
        if (!buffer) throw new Error('No buffer')
        buffers.push(buffer)
      }
    } catch {
      cleanup()
      setFallback(true)
      return
    }
    let visible = true
    let lost = false
    let frame: number | null = null
    function draw() {
      frame = null
      if (!visible || document.hidden || lost || !program) return
      const rect = canvas!.getBoundingClientRect()
      const dpr = Math.min(
        window.devicePixelRatio || 1,
        rect.width < 500 ? 1.5 : 2,
      )
      canvas!.width = Math.max(1, Math.round(rect.width * dpr))
      canvas!.height = Math.max(1, Math.round(rect.height * dpr))
      ctx.viewport(0, 0, canvas!.width, canvas!.height)
      ctx.clearColor(0, 0, 0, 0)
      ctx.clear(ctx.COLOR_BUFFER_BIT)
      ctx.useProgram(program)
      ctx.enable(ctx.BLEND)
      ctx.blendFunc(ctx.SRC_ALPHA, ctx.ONE)
      const data = sceneRef.current
      const values = [
        data.flatMap((n) => [n.x, n.y, 0]),
        data.flatMap((n) => {
          const hex =
            categoryColors[
              n.detail.latest_analysis?.category ?? 'unknown'
            ].slice(1)
          return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        }),
        data.map((n) => n.size),
      ]
      ;['aPosition', 'aColor', 'aSize'].forEach((name, i) => {
        const location = ctx.getAttribLocation(program, name)
        ctx.bindBuffer(ctx.ARRAY_BUFFER, buffers[i])
        ctx.bufferData(
          ctx.ARRAY_BUFFER,
          new Float32Array(values[i]),
          ctx.DYNAMIC_DRAW,
        )
        ctx.enableVertexAttribArray(location)
        ctx.vertexAttribPointer(
          location,
          i === 2 ? 1 : 3,
          ctx.FLOAT,
          false,
          0,
          0,
        )
      })
      ctx.uniform1f(ctx.getUniformLocation(program, 'uRatio'), dpr)
      ctx.drawArrays(ctx.POINTS, 0, data.length)
    }
    const schedule = () => {
      if (frame === null && visible && !document.hidden && !lost)
        frame = requestAnimationFrame(draw)
    }
    drawRef.current = schedule
    const resize =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(schedule)
        : null
    resize?.observe(canvas)
    const observer =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting
            if (visible) schedule()
            else if (frame !== null) {
              cancelAnimationFrame(frame)
              frame = null
            }
          })
        : null
    observer?.observe(canvas)
    const visibility = () => {
      if (document.hidden && frame !== null) {
        cancelAnimationFrame(frame)
        frame = null
      } else schedule()
    }
    const contextLost = (event: Event) => {
      event.preventDefault()
      lost = true
      if (frame !== null) cancelAnimationFrame(frame)
      setFallback(true)
    }
    canvas.addEventListener('webglcontextlost', contextLost)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      drawRef.current = null
      if (frame !== null) cancelAnimationFrame(frame)
      resize?.disconnect()
      observer?.disconnect()
      canvas.removeEventListener('webglcontextlost', contextLost)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('resize', schedule)
      cleanup()
    }
  }, [])
  useEffect(() => {
    drawRef.current?.()
  }, [items, view, aspect])
  const edge = graph.edges[Number(edgeIndex)]
  return (
    <div className={`map-scene ${paused ? 'map-paused' : ''}`}>
      <div
        ref={stageRef}
        className={`signal-stage ${fallback ? 'map-fallback' : ''} ${controls.dragging ? 'is-dragging' : ''}`}
        tabIndex={0}
        role="group"
        aria-label="Область 3D-карты"
        aria-describedby="graph-gesture-help"
        {...controls.handlers}
      >
        <svg
          className="spatial-guides"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {[0, 1, 2].map((axis) => (
            <polyline
              key={axis}
              points={Array.from({ length: 65 }, (_, i) => {
                const t = (i / 64) * Math.PI * 2
                const circle: [number, number, number] =
                  axis === 0
                    ? [Math.cos(t) * 1.5, 0, Math.sin(t) * 1.5]
                    : axis === 1
                      ? [0, Math.cos(t) * 1.5, Math.sin(t) * 1.5]
                      : [Math.cos(t) * 1.5, Math.sin(t) * 1.5, 0]
                const p = project(circle, view, aspect)
                return `${(p.x + 1) * 50},${(1 - p.y) * 50}`
              }).join(' ')}
            />
          ))}
        </svg>
        <svg
          className="graph-edges"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {graph.edges.map((e, i) => {
            const a = pointById.get(e.from)!
            const b = pointById.get(e.to)!
            return (
              <line
                key={`${e.from}-${e.to}`}
                x1={(a.x + 1) * 50}
                y1={(1 - a.y) * 50}
                x2={(b.x + 1) * 50}
                y2={(1 - b.y) * 50}
                className={String(i) === edgeIndex ? 'selected-edge' : ''}
              />
            )
          })}
        </svg>
        <canvas ref={canvasRef} aria-hidden="true" />
        {projected.map((n) => {
          const included = report.draft.items.some((i) => i.id === n.id)
          const high = ['high', 'critical'].includes(
            n.detail.latest_analysis?.proposed_priority ?? '',
          )
          return (
            <Link
              key={n.id}
              to={`/publications/${encodeURIComponent(n.id)}`}
              state={{ returnTo }}
              aria-label={`На карте: ${n.detail.publication.title}`}
              className={`map-node ${highlighted === n.id ? 'selected' : ''} ${high ? 'high-node' : ''}`}
              style={
                {
                  left: `${(n.x + 1) * 50}%`,
                  top: `${(1 - n.y) * 50}%`,
                  width: Math.max(32, n.size),
                  height: Math.max(32, n.size),
                  '--node-size': `${n.size}px`,
                  '--node-color':
                    categoryColors[
                      n.detail.latest_analysis?.category ?? 'unknown'
                    ],
                } as React.CSSProperties
              }
              onMouseEnter={() => {
                onHighlight(n.id)
                setInspectedId(n.id)
              }}
              onMouseLeave={() => onHighlight(null)}
              onFocus={() => {
                onHighlight(n.id)
                setInspectedId(n.id)
              }}
              onBlur={() => onHighlight(null)}
            >
              <span className="node-sphere" aria-hidden="true" />
              <span className="node-label" aria-hidden="true">
                {n.detail.publication.title}
              </span>
              {included && (
                <span className="node-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </Link>
          )
        })}
        <span className="map-mode">
          {fallback
            ? '2D-карта · WebGL недоступен'
            : '3D · Пространство публикаций'}
        </span>
      </div>
      <label className="map-source-toggle">
        <input
          type="checkbox"
          checked={includeSources}
          onChange={(e) => setIncludeSources(e.target.checked)}
        />
        Связи по общему источнику
      </label>
      <p className="graph-gesture-help" id="graph-gesture-help">
        Потяните — вращение · Колесо / щипок — масштаб <br />
        Два пальца / Shift — перемещение · Двойное нажатие — сброс
      </p>
      <div className="map-inspector" aria-live="polite">
        {selected ? (
          <>
            <strong>{selected.publication.title}</strong>
            <span>
              {formatDate(selected.publication.published_at)} · AI:{' '}
              {formatPriority(
                selected.latest_analysis?.proposed_priority ?? 'unknown',
              )}
            </span>
            <button
              type="button"
              onClick={() => {
                document
                  .getElementById(`publication-${selected.publication.id}`)
                  ?.scrollIntoView({ block: 'center', behavior: 'instant' })
                onHighlight(selected.publication.id)
              }}
            >
              Показать карточку в ленте
            </button>
          </>
        ) : (
          <>
            <strong>
              {items.length
                ? 'Исследуйте публикации'
                : 'Нет публикаций для карты'}
            </strong>
            <span>
              Нажмите на узел для анализа. Стрелки и + / − тоже управляют
              картой.
            </span>
          </>
        )}
      </div>
      {graph.edges.length > 0 ? (
        <div className="edge-inspector">
          <label>
            Основания связей
            <select
              value={edgeIndex}
              onChange={(e) => setEdgeIndex(e.target.value)}
            >
              <option value="">Выберите связь ({graph.edges.length})</option>
              {graph.edges.map((e, i) => (
                <option key={i} value={i}>
                  {pointById.get(e.from)!.detail.publication.title} ↔{' '}
                  {pointById.get(e.to)!.detail.publication.title}
                </option>
              ))}
            </select>
          </label>
          {edgeIndex && edge && (
            <p>
              {edge.reasons.join('. ')}. Общий источник или совпадение не
              доказывают тематическую или причинную связь или дубликат.
            </p>
          )}
        </div>
      ) : (
        <p className="map-footnote">
          Общих оснований нет — новости показаны отдельно.
        </p>
      )}
      <details className="map-news-list">
        <summary>Список новостей на карте</summary>
        <ol>
          {graph.nodes.map((n) => (
            <li key={n.id}>
              <Link
                to={`/publications/${encodeURIComponent(n.id)}`}
                state={{ returnTo }}
                onFocus={() => {
                  onHighlight(n.id)
                  setInspectedId(n.id)
                }}
                onBlur={() => onHighlight(null)}
              >
                {n.detail.publication.title}
              </Link>
            </li>
          ))}
        </ol>
      </details>
    </div>
  )
}
