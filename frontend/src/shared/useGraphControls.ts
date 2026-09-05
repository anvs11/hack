import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type RefObject,
} from 'react'
import { clampGraphView, initialGraphView, type GraphView } from './signalGraph'

type Point = { x: number; y: number }
export function useGraphControls(
  stage: RefObject<HTMLDivElement | null>,
  paused: boolean,
  setView: Dispatch<SetStateAction<GraphView>>,
) {
  const pointers = useRef(new Map<number, Point>())
  const start = useRef<Point | null>(null)
  const moved = useRef(false)
  const [dragging, setDragging] = useState(false)
  const change = (update: (view: GraphView) => GraphView) =>
    setView((view) => clampGraphView(update(view)))
  useEffect(() => {
    const element = stage.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      if (paused) return
      event.preventDefault()
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? element.clientHeight
            : 1)
      setView((view) =>
        clampGraphView({
          ...view,
          zoom: view.zoom * Math.exp(-delta * 0.0015),
        }),
      )
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [stage, paused, setView])
  useEffect(() => {
    if (paused) {
      pointers.current.clear()
      start.current = null
      setDragging(false)
    }
  }, [paused])
  const finish = (id: number) => {
    pointers.current.delete(id)
    if (!pointers.current.size) {
      start.current = null
      setDragging(false)
    }
  }
  return {
    dragging,
    handlers: {
      onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
        if (paused || ![0, 1, 2].includes(event.button)) return
        if (!pointers.current.size) {
          moved.current = false
          start.current = { x: event.clientX, y: event.clientY }
        }
        pointers.current.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
        })
        if (pointers.current.size > 1) moved.current = true
        // Capture on the original target so a tap on a node remains a normal link.
        if (event.target instanceof Element)
          event.target.setPointerCapture(event.pointerId)
      },
      onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
        const previous = pointers.current.get(event.pointerId)
        if (!previous || paused) return
        const next = { x: event.clientX, y: event.clientY }
        const oldPoints = [...pointers.current.values()]
        pointers.current.set(event.pointerId, next)
        const rect = stage.current!.getBoundingClientRect()
        const dx = next.x - previous.x,
          dy = next.y - previous.y
        if (
          start.current &&
          Math.hypot(next.x - start.current.x, next.y - start.current.y) > 5
        )
          moved.current = true
        if (!moved.current) return
        setDragging(true)
        if (pointers.current.size === 2) {
          const [a, b] = oldPoints,
            [c, d] = [...pointers.current.values()]
          const before = Math.hypot(a.x - b.x, a.y - b.y)
          const after = Math.hypot(c.x - d.x, c.y - d.y)
          change((view) => ({
            ...view,
            zoom: before > 1 ? (view.zoom * after) / before : view.zoom,
            panX: view.panX + dx / rect.width,
            panY: view.panY - dy / rect.height,
          }))
        } else if (
          event.shiftKey ||
          event.buttons === 2 ||
          event.buttons === 4
        ) {
          change((view) => ({
            ...view,
            panX: view.panX + (dx * 2) / rect.width,
            panY: view.panY - (dy * 2) / rect.height,
          }))
        } else {
          change((view) => ({
            ...view,
            yaw: view.yaw + dx * 0.009,
            pitch: view.pitch + dy * 0.009,
          }))
        }
      },
      onPointerUp: (event: React.PointerEvent<HTMLDivElement>) =>
        finish(event.pointerId),
      onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) =>
        finish(event.pointerId),
      onLostPointerCapture: (event: React.PointerEvent<HTMLDivElement>) =>
        finish(event.pointerId),
      onClickCapture: (event: React.MouseEvent<HTMLDivElement>) => {
        if (moved.current && event.detail !== 0) {
          event.preventDefault()
          event.stopPropagation()
        }
      },
      onAuxClickCapture: (event: React.MouseEvent<HTMLDivElement>) => {
        if (moved.current) {
          event.preventDefault()
          event.stopPropagation()
        }
      },
      onContextMenu: (event: React.MouseEvent<HTMLDivElement>) =>
        event.preventDefault(),
      onDoubleClick: () => {
        if (!paused) setView(initialGraphView)
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (paused || event.target !== event.currentTarget) return
        const step = 0.15
        const actions: Record<string, (v: GraphView) => GraphView> = {
          ArrowLeft: (v) => ({ ...v, yaw: v.yaw - step }),
          ArrowRight: (v) => ({ ...v, yaw: v.yaw + step }),
          ArrowUp: (v) => ({ ...v, pitch: v.pitch - step }),
          ArrowDown: (v) => ({ ...v, pitch: v.pitch + step }),
          '+': (v) => ({ ...v, zoom: v.zoom * 1.2 }),
          '=': (v) => ({ ...v, zoom: v.zoom * 1.2 }),
          '-': (v) => ({ ...v, zoom: v.zoom / 1.2 }),
          '0': () => initialGraphView,
        }
        if (actions[event.key]) {
          event.preventDefault()
          change(actions[event.key])
        }
      },
    },
  }
}
