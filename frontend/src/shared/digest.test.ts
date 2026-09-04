import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import {
  buildDigestSnapshot,
  digestFilename,
  escapeMarkdown,
  loadDigestSourceData,
  serializeDigestJson,
  serializeDigestMarkdown,
  type DigestSourceData,
} from './digest'
import {
  analysis001v2,
  existingDecision,
  publicationDetails,
  publicationHistory,
  regulatoryCaseDetail,
  sources,
} from '../mocks/fixtures'
import type {
  AnalysisVersion,
  LifecycleEvent,
  PublicationDetail,
  SpecialistDecision,
} from './api/types'
import { server } from '../test/setup'

const generatedAt = '2026-09-04T10:20:30.000Z'

function decision(
  overrides: Partial<SpecialistDecision> = {},
): SpecialistDecision {
  return {
    ...existingDecision,
    id: 'decision-current',
    analysis_id: analysis001v2.id,
    version: 2,
    status: 'confirmed',
    final_summary: null,
    final_priority: 'critical',
    created_at: '2026-09-04T09:00:00Z',
    ...overrides,
  }
}

function sourceData(overrides: Partial<DigestSourceData> = {}): DigestSourceData {
  return {
    publications: structuredClone(publicationDetails),
    publication_histories: [structuredClone(publicationHistory)],
    regulatory_cases: [structuredClone(regulatoryCaseDetail)],
    sources: structuredClone(sources),
    ...overrides,
  }
}

function withLatestDecision(value: SpecialistDecision): PublicationDetail[] {
  const publications: PublicationDetail[] = structuredClone(publicationDetails)
  publications[0] = { ...publications[0], latest_decision: value }
  return publications
}

describe('buildDigestSnapshot', () => {
  it.each(['confirmed', 'corrected'] as const)(
    'includes a current %s critical decision',
    (status) => {
      const currentDecision = decision({ status })
      const snapshot = buildDigestSnapshot(
        sourceData({ publications: withLatestDecision(currentDecision) }),
        generatedAt,
      )

      expect(snapshot.critical_materials).toHaveLength(1)
      expect(snapshot.critical_materials[0]).toMatchObject({
        id: currentDecision.id,
        decision_status: status,
        priority: 'critical',
        summary: analysis001v2.summary,
      })
    },
  )

  it('excludes a rejected critical decision', () => {
    const rejected = decision({ status: 'rejected' })
    const snapshot = buildDigestSnapshot(
      sourceData({ publications: withLatestDecision(rejected) }),
      generatedAt,
    )

    expect(snapshot.critical_materials).toEqual([])
  })

  it('does not confirm a critical decision for an outdated analysis', () => {
    const outdated = decision({ analysis_id: 'analysis-001' })
    const snapshot = buildDigestSnapshot(
      sourceData({ publications: withLatestDecision(outdated) }),
      generatedAt,
    )

    expect(snapshot.critical_materials).toEqual([])
  })

  it('puts a new reviewable analysis without a current decision in the review queue', () => {
    const outdated = decision({ analysis_id: 'analysis-001' })
    const snapshot = buildDigestSnapshot(
      sourceData({ publications: withLatestDecision(outdated) }),
      generatedAt,
    )

    expect(snapshot.review_queue.map((item) => item.publication_id)).toContain('pub-001')
  })

  it('excludes a reviewed current analysis from the review queue', () => {
    const current = decision()
    const snapshot = buildDigestSnapshot(
      sourceData({ publications: withLatestDecision(current) }),
      generatedAt,
    )

    expect(snapshot.review_queue.map((item) => item.publication_id)).not.toContain('pub-001')
  })

  it('sorts a timeline before deriving initial and subsequent transitions', () => {
    const introduced = {
      ...regulatoryCaseDetail.timeline[0],
      id: 'event-002',
      stage: 'introduced',
      occurred_at: '2026-09-02T07:30:00Z',
      created_at: '2026-09-02T08:10:00Z',
    } satisfies LifecycleEvent
    const details = [{
      ...structuredClone(regulatoryCaseDetail),
      timeline: [introduced, structuredClone(regulatoryCaseDetail.timeline[0])],
    }]

    const snapshot = buildDigestSnapshot(
      sourceData({ regulatory_cases: details }),
      generatedAt,
    )
    const chronological = [...snapshot.lifecycle_changes].reverse()

    expect(chronological.map(({ from_stage, stage }) => ({ from_stage, stage }))).toEqual([
      { from_stage: null, stage: 'draft' },
      { from_stage: 'draft', stage: 'introduced' },
    ])
  })

  it('combines specialist decisions and lifecycle events into user actions', () => {
    const snapshot = buildDigestSnapshot(sourceData(), generatedAt)

    expect(snapshot.user_actions.map((item) => item.type)).toEqual([
      'specialist_decision',
      'lifecycle_event',
    ])
  })

  it('includes every saved decision version in user actions', () => {
    const secondDecision = decision({ id: 'decision-002' })
    const histories = [{
      ...structuredClone(publicationHistory),
      decisions: [structuredClone(existingDecision), secondDecision],
    }]
    const snapshot = buildDigestSnapshot(
      sourceData({ publication_histories: histories }),
      generatedAt,
    )

    expect(snapshot.user_actions.filter((item) => item.type === 'specialist_decision'))
      .toHaveLength(2)
  })

  it('uses type and id as deterministic tie-breakers for equal action dates', () => {
    const sameDate = regulatoryCaseDetail.timeline[0].created_at
    const sameDateDecision = decision({ id: 'z-decision', created_at: sameDate })
    const histories = [{
      ...structuredClone(publicationHistory),
      decisions: [sameDateDecision],
    }]
    const snapshot = buildDigestSnapshot(
      sourceData({ publication_histories: histories }),
      generatedAt,
    )

    expect(snapshot.user_actions.map((item) => `${item.type}:${item.id}`)).toEqual([
      'lifecycle_event:event-001',
      'specialist_decision:z-decision',
    ])
  })

  it('does not mutate input arrays or nested objects', () => {
    const data = sourceData()
    const before = structuredClone(data)

    buildDigestSnapshot(data, generatedAt)

    expect(data).toEqual(before)
  })

  it('handles a missing analysis safely', () => {
    const details: PublicationDetail[] = structuredClone(publicationDetails)
    details[0] = {
      ...details[0],
      publication: { ...details[0].publication, latest_analysis_id: null },
      latest_analysis: null,
      latest_decision: decision(),
    }

    expect(() => buildDigestSnapshot(
      sourceData({ publications: details }),
      generatedAt,
    )).not.toThrow()
  })

  it('falls back to source_id when source metadata is absent', () => {
    const snapshot = buildDigestSnapshot(sourceData({ sources: [] }), generatedAt)
    const item = snapshot.review_queue.find((review) => review.publication_id === 'pub-005')

    expect(item?.source_name).toBe('Источник source-telegram-archive')
  })

  it('uses final summary for a confirmed critical item when provided', () => {
    const current = decision({ final_summary: 'Финальное саммари' })
    const snapshot = buildDigestSnapshot(
      sourceData({ publications: withLatestDecision(current) }),
      generatedAt,
    )

    expect(snapshot.critical_materials[0].summary).toBe('Финальное саммари')
  })

  it('is deterministic for the same data and generatedAt', () => {
    const data = sourceData()
    expect(buildDigestSnapshot(data, generatedAt)).toEqual(
      buildDigestSnapshot(data, generatedAt),
    )
  })
})

describe('digest serializers', () => {
  it('serializes JSON that parses back to the exact snapshot and ends with a newline', () => {
    const snapshot = buildDigestSnapshot(sourceData(), generatedAt)
    const json = serializeDigestJson(snapshot)

    expect(JSON.parse(json)).toEqual(snapshot)
    expect(json.endsWith('\n')).toBe(true)
  })

  it('uses all four fixed Markdown section headings', () => {
    const markdown = serializeDigestMarkdown(
      buildDigestSnapshot(sourceData(), generatedAt),
    )

    expect(markdown).toContain('## Подтверждённые критические материалы')
    expect(markdown).toContain('## Изменения стадий НПА')
    expect(markdown).toContain('## Требующие проверки карточки')
    expect(markdown).toContain('## Действия пользователей')
  })

  it('marks every empty section explicitly', () => {
    const markdown = serializeDigestMarkdown(buildDigestSnapshot(
      sourceData({
        publications: [],
        publication_histories: [],
        regulatory_cases: [],
      }),
      generatedAt,
    ))

    expect(markdown.match(/Нет элементов/g)).toHaveLength(4)
  })

  it('escapes Markdown metacharacters in user text', () => {
    const riskyAnalysis: AnalysisVersion = {
      ...analysis001v2,
      summary: '# [важно](https://unsafe) *срочно* | сейчас',
    }
    const details: PublicationDetail[] = structuredClone(publicationDetails)
    details[0] = { ...details[0], latest_analysis: riskyAnalysis, latest_decision: null }
    const markdown = serializeDigestMarkdown(buildDigestSnapshot(
      sourceData({ publications: details }),
      generatedAt,
    ))

    expect(markdown).toContain('\\# \\[важно\\]\\(https://unsafe\\) \\*срочно\\* \\| сейчас')
    expect(escapeMarkdown('a_b')).toBe('a\\_b')
  })

  it('uses the snapshot generated_at in both exports', () => {
    const snapshot = buildDigestSnapshot(sourceData(), generatedAt)

    expect(serializeDigestJson(snapshot)).toContain(generatedAt)
    expect(serializeDigestMarkdown(snapshot)).toContain('4 сентября 2026 г. в 10:20')
  })

  it('forms deterministic filenames without milliseconds', () => {
    expect(digestFilename(generatedAt, 'json')).toBe('digest-2026-09-04T10-20-30Z.json')
    expect(digestFilename(generatedAt, 'md')).toBe('digest-2026-09-04T10-20-30Z.md')
  })
})

describe('digest data loader', () => {
  it('loads every publication page and each required history and case detail once', async () => {
    const offsets: number[] = []
    let historyRequests = 0
    let caseRequests = 0
    server.use(
      http.get('*/api/publications', ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset'))
        offsets.push(offset)
        return HttpResponse.json({
          items: publicationDetails.slice(offset, offset + 1),
          total: 2,
          limit: 100,
          offset,
        })
      }),
      http.get('*/api/publications/pub-001/history', () => {
        historyRequests += 1
        return HttpResponse.json(publicationHistory)
      }),
      http.get('*/api/regulatory-cases/case-001', () => {
        caseRequests += 1
        return HttpResponse.json(regulatoryCaseDetail)
      }),
    )

    const data = await loadDigestSourceData(new AbortController().signal)

    expect(offsets).toEqual([0, 1])
    expect(data.publications).toHaveLength(2)
    expect(historyRequests).toBe(1)
    expect(caseRequests).toBe(1)
  })
})
