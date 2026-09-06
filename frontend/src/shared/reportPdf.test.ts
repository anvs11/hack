import { describe, expect, it } from 'vitest'
import { publicationDetails, sources } from '../mocks/fixtures'
import { captureItem, emptyDraft } from './report'
import { reportPdfDefinition, reportPdfFilename } from './reportPdf'

describe('report PDF export', () => {
  it('builds a Cyrillic document from the immutable report snapshot', () => {
    const item = captureItem(publicationDetails[0], sources[0])
    item.comment = 'Проверить на совещании'
    const definition = reportPdfDefinition({
      ...emptyDraft(),
      title: 'Утренний обзор',
      summary: 'Главные изменения за сутки.',
      items: [item],
    })
    const serialized = JSON.stringify(definition)

    expect(serialized).toContain('Утренний обзор')
    expect(serialized).toContain(publicationDetails[0].publication.title)
    expect(serialized).toContain('Проверить на совещании')
    expect(serialized).toContain(publicationDetails[0].publication.original_url)
  })

  it('uses a stable PDF filename', () => {
    expect(reportPdfFilename(new Date('2026-09-06T10:00:00Z'))).toBe(
      'RegRadar-report-2026-09-06.pdf',
    )
  })
})
