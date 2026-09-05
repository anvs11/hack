import type { Category, PublicationDetail } from './api/types'
export const categoryColors: Record<Category, string> = {
  regulation: '#9d9aff',
  reputation: '#ff9cab',
  competitor: '#68ddca',
  trend: '#8bbcff',
  unknown: '#a5b2c8',
}
export function positionForId(id: string): [number, number, number] {
  let seed = 2166136261
  for (const char of id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619)
  const random = () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) / 4294967295
  }
  for (let i = 0; i < 5; i++) random()
  const angle = random() * Math.PI * 2
  const height = random() * 1.7 - 0.85
  const radius = 0.6 + random() * 0.55
  return [Math.cos(angle) * radius, height, Math.sin(angle) * radius]
}
export function buildGraph(
  items: PublicationDetail[],
  includeSources = false,
  sourceNames: Record<string, string> = {},
) {
  const nodes = items.slice(0, 50).map((detail) => ({
    id: detail.publication.id,
    detail,
    position: positionForId(detail.publication.id),
  }))
  const edges: { from: string; to: string; reasons: string[] }[] = []
  const normalize = (s: string) => s.trim().toLocaleLowerCase('ru-RU')
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i].detail
      const b = nodes[j].detail
      const bTags = new Set(b.publication.tags.map(normalize))
      const bEntities = new Set(
        b.latest_analysis?.entities.map(
          (e) => `${normalize(e.type)}:${normalize(e.value)}`,
        ),
      )
      const reasons = [
        ...new Set([
          ...(includeSources &&
          a.publication.source_id === b.publication.source_id
            ? [
                `Общий источник «${sourceNames[a.publication.source_id] ?? a.publication.source_id}»`,
              ]
            : []),
          ...a.publication.tags
            .filter((t) => normalize(t) && bTags.has(normalize(t)))
            .map((t) => `Общий тег «${t}»`),
          ...(a.latest_analysis?.entities
            .filter(
              (e) =>
                normalize(e.value) &&
                bEntities.has(`${normalize(e.type)}:${normalize(e.value)}`),
            )
            .map((e) => `Общая сущность «${e.value}» (${e.type})`) ?? []),
        ]),
      ]
      if (reasons.length)
        edges.push({ from: nodes[i].id, to: nodes[j].id, reasons })
    }
  return { nodes, edges }
}
export type GraphView = {
  yaw: number
  pitch: number
  zoom: number
  panX: number
  panY: number
}
export const initialGraphView: GraphView = {
  yaw: -0.45,
  pitch: 0.25,
  zoom: 1,
  panX: 0,
  panY: 0,
}
export function clampGraphView(view: GraphView): GraphView {
  return {
    ...view,
    zoom: Math.max(0.5, Math.min(3, view.zoom)),
    pitch: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, view.pitch)),
    panX: Math.max(-1.5, Math.min(1.5, view.panX)),
    panY: Math.max(-1.5, Math.min(1.5, view.panY)),
  }
}
export function project(
  position: [number, number, number],
  view: GraphView,
  aspect = 1,
) {
  const [x, y, z] = position
  const xx = Math.cos(view.yaw) * x + Math.sin(view.yaw) * z
  const zz = -Math.sin(view.yaw) * x + Math.cos(view.yaw) * z
  const yy = Math.cos(view.pitch) * y - Math.sin(view.pitch) * zz
  const depth = 4 - (Math.sin(view.pitch) * y + Math.cos(view.pitch) * zz)
  return {
    x: (xx * 2.7 * view.zoom) / (depth * aspect) + view.panX,
    y: (yy * 2.7 * view.zoom) / depth + view.panY,
    size: (140 * view.zoom) / depth,
    depth,
  }
}
