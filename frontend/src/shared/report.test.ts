import { describe, expect, it } from 'vitest'
import {
  publicationDetails,
  sources,
  existingDecision,
} from '../mocks/fixtures'
import { createReportStore } from './ReportStore'
import {
  captureItem,
  decisionStatus,
  emptyDraft,
  parseDraft,
  reportJson,
  reportMarkdown,
  snapshotChanged,
} from './report'
import {
  buildGraph,
  positionForId,
  project,
  clampGraphView,
  initialGraphView,
} from './signalGraph'
import { dateBoundary, dateError, parseFeedQuery } from './feedQuery'
function memory() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, v: string) => {
      values.set(key, v)
    },
  }
}
const detail = publicationDetails[0]
describe('versioned local report', () => {
  it('deduplicates batch selection, persists order and comments, and restores on reload', () => {
    const storage = memory()
    const store = createReportStore('demo:user1', storage)
    store.add([{ detail }, { detail: publicationDetails[1] }, { detail }])
    store.add([{ detail }])
    store.edit({ title: 'Обзор', summary: 'Контекст' })
    store.comment(detail.publication.id, 'Для менеджера')
    store.move(detail.publication.id, 1)
    const loaded = createReportStore('demo:user1', storage).getSnapshot().draft
    expect(loaded.items.map((i) => i.id)).toEqual([
      publicationDetails[1].publication.id,
      detail.publication.id,
    ])
    expect(loaded.items[1].comment).toBe('Для менеджера')
    expect(loaded.title).toBe('Обзор')
    expect(
      createReportStore('live:user1', storage).getSnapshot().draft.items,
    ).toEqual([])
    expect(
      createReportStore('demo:user2', storage).getSnapshot().draft.items,
    ).toEqual([])
  })
  it('keeps immutable snapshots until explicitly refreshed, preserving comments', () => {
    const store = createReportStore('draft', memory())
    const changing = structuredClone(detail)
    store.add([{ detail: changing, source: sources[0] }])
    store.comment(detail.publication.id, 'Мой комментарий')
    const saved = store.getSnapshot().draft.items[0]
    changing.latest_analysis!.id = 'new-analysis'
    changing.latest_analysis!.summary = 'Новая версия'
    expect(saved.detail.latest_analysis!.summary).not.toBe('Новая версия')
    expect(snapshotChanged(saved, changing)).toBe(true)
    store.refresh(changing.publication.id, changing)
    expect(store.getSnapshot().draft.items[0].comment).toBe('Мой комментарий')
    expect(store.getSnapshot().draft.items[0].detail.latest_analysis!.id).toBe(
      'new-analysis',
    )
    expect(store.getSnapshot().draft.items[0].source).toEqual(saved.source)
  })
  it('does not overwrite corrupted storage and provides original bytes for recovery', () => {
    const storage = memory()
    storage.setItem('draft', '{broken')
    const store = createReportStore('draft', storage)
    store.add([{ detail }])
    expect(store.getSnapshot().warning).toContain('повреждены')
    expect(store.getSnapshot().recovery).toBe('{broken')
    expect(storage.getItem('draft')).toBe('{broken')
    expect(store.getSnapshot().draft.items).toHaveLength(1)
  })
  it('keeps unsaved changes in memory when storage access or quota fails', () => {
    const store = createReportStore('draft', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    })
    store.add([{ detail }])
    expect(store.getSnapshot().warning).toContain('только в памяти')
    expect(store.getSnapshot().draft.items).toHaveLength(1)
    expect(createReportStore('draft', null).getSnapshot().warning).toContain(
      'недоступно',
    )
  })
  it('rejects malformed nested snapshots and unknown schema versions', () => {
    const valid = { ...emptyDraft(), items: [captureItem(detail)] }
    expect(parseDraft(JSON.stringify(valid))).toEqual(valid)
    expect(() =>
      parseDraft(JSON.stringify({ ...valid, schema_version: 2 })),
    ).toThrow()
    const invalid = structuredClone(valid)
    ;(invalid.items[0].detail.latest_analysis!.evidence as unknown) = [null]
    expect(() => parseDraft(JSON.stringify(invalid))).toThrow()
  })
  it('distinguishes absent, current confirmed, corrected, rejected and stale decisions', () => {
    expect(decisionStatus({ ...detail, latest_decision: null })).toBe(
      'Нет решения специалиста',
    )
    for (const [status, label] of [
      ['confirmed', 'подтверждено'],
      ['corrected', 'скорректировано'],
      ['rejected', 'отклонено'],
    ] as const) {
      const d = {
        ...detail,
        latest_decision: {
          ...existingDecision,
          analysis_id: detail.latest_analysis!.id,
          status,
        },
      }
      expect(decisionStatus(d)).toBe(`Специалист: ${label}`)
      expect(decisionStatus({ ...d, latest_analysis: null })).toBe(
        `Предыдущая версия: ${label}`,
      )
    }
  })
  it('exports only selected snapshots with original statuses, null values and manager comments', () => {
    const nullDetail = {
      ...detail,
      latest_analysis: { ...detail.latest_analysis!, importance_score: null },
      latest_decision: null,
    }
    const item = {
      ...captureItem(nullDetail, sources[0]),
      comment: 'Рассмотреть на встрече',
    }
    const draft = { ...emptyDraft(), title: 'Отчёт', items: [item] }
    const json = JSON.parse(reportJson(draft))
    expect(json.brand).toBe('RegRadar')
    expect(json.items).toHaveLength(1)
    expect(json.items[0].detail.latest_analysis.importance_score).toBeNull()
    const md = reportMarkdown(draft)
    expect(md).toContain('RegRadar')
    expect(md).toContain('Нет решения специалиста')
    expect(md).toContain('Рассмотреть на встрече')
    expect(md).toContain('Важность: Нет данных')
    expect(md).not.toContain(publicationDetails[1].publication.title)
  })
})
describe('honest graph and query boundaries', () => {
  it('adds only explicit shared-source links when that layer is enabled', () => {
    const a = structuredClone(publicationDetails[0])
    const b = structuredClone(publicationDetails[1])
    b.publication.source_id = a.publication.source_id
    a.publication.tags = []
    b.publication.tags = []
    a.latest_analysis!.entities = []
    b.latest_analysis!.entities = []
    expect(buildGraph([a, b]).edges).toHaveLength(0)
    expect(
      buildGraph([a, b], true, { [a.publication.source_id]: 'Редакция' })
        .edges[0].reasons,
    ).toEqual(['Общий источник «Редакция»'])
    b.publication.source_id = 'different-source'
    expect(buildGraph([a, b], true).edges).toHaveLength(0)
  })
  it('projects both rotation axes and zoom while bounding the camera controls', () => {
    const point: [number, number, number] = [0.6, 0.2, 0.8]
    const original = project(point, initialGraphView)
    expect(project(point, { ...initialGraphView, yaw: 1 }).x).not.toBe(
      original.x,
    )
    expect(project(point, { ...initialGraphView, pitch: 1 }).y).not.toBe(
      original.y,
    )
    expect(project(point, { ...initialGraphView, zoom: 2 }).size).toBe(
      original.size * 2,
    )
    expect(
      clampGraphView({ ...initialGraphView, zoom: 100, panX: 8, pitch: 8 }),
    ).toMatchObject({ zoom: 3, panX: 1.5, pitch: Math.PI / 2 })
  })
  it('uses stable ID coordinates and only explained tag/entity edges, capped at 50', () => {
    const isolated = buildGraph(publicationDetails)
    expect(isolated.edges).toEqual([])
    const a = structuredClone(publicationDetails[0])
    const b = structuredClone(publicationDetails[1])
    a.publication.tags = ['Данные']
    b.publication.tags = ['данные']
    const graph = buildGraph([a, b])
    expect(graph.edges[0].reasons).toEqual(['Общий тег «Данные»'])
    expect(buildGraph([b, a]).nodes[1].position).toEqual(
      positionForId(a.publication.id),
    )
    expect(
      buildGraph(
        Array.from({ length: 80 }, (_, i) => ({
          ...a,
          publication: { ...a.publication, id: String(i) },
        })),
      ).nodes,
    ).toHaveLength(50)
  })
  it('validates date ranges and includes the end of the final local day', () => {
    const from = dateBoundary('2026-09-01')
    const to = dateBoundary('2026-09-01', true)
    expect(Date.parse(to) - Date.parse(from)).toBe(86_399_999)
    expect(to).toMatch(/\.999999Z$/)
    expect(dateError({ published_from: to, published_to: from })).toContain(
      'не позже',
    )
    expect(dateError({ published_from: 'invalid' })).toContain('Некорректная')
    expect(
      parseFeedQuery(
        new URLSearchParams('limit=-1&offset=NaN&visibility=hidden'),
      ).limit,
    ).toBe(10)
    expect(
      parseFeedQuery(
        new URLSearchParams('offset=20&limit=5&needs_review=false'),
      ),
    ).toMatchObject({ limit: 5, offset: 20, needs_review: false })
  })
})
