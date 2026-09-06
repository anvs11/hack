import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'
import { decisionStatus, safeUrl, type ReportDraft } from './report'
import { sourceTypeLabel } from './feedQuery'
import {
  formatCategory,
  formatDate,
  formatPriority,
  formatSourceName,
} from './format'

export function reportPdfFilename(now = new Date()) {
  return `RegRadar-report-${now.toISOString().slice(0, 10)}.pdf`
}

export function reportPdfDefinition(draft: ReportDraft): TDocumentDefinitions {
  const content: Content[] = [
    { text: 'RegRadar', style: 'brand' },
    { text: draft.title || 'Отчёт без названия', style: 'title' },
    {
      text: `Обновлён: ${formatDate(draft.updated_at)} · ${draft.items.length} материалов`,
      style: 'metadata',
    },
    {
      text: draft.summary || 'Резюме не добавлено.',
      style: 'summary',
    },
  ]

  draft.items.forEach((item, index) => {
    const { publication, latest_analysis: analysis, latest_decision: decision } =
      item.detail
    const originalUrl = safeUrl(publication.original_url)
    const summary = analysis?.summary ?? publication.content.slice(0, 700)
    const status = [
      formatCategory(analysis?.category ?? 'unknown'),
      `AI-приоритет: ${formatPriority(analysis?.proposed_priority ?? 'unknown')}`,
      decisionStatus(item.detail),
    ].join(' · ')

    content.push(
      { text: `${index + 1}. ${publication.title}`, style: 'itemTitle' },
      {
        text: [
          formatSourceName(item.source?.name ?? publication.source_id),
          sourceTypeLabel(item.source?.type),
          formatDate(publication.published_at),
        ].join(' · '),
        style: 'metadata',
      },
      ...(originalUrl
        ? ([{ text: originalUrl, link: originalUrl, style: 'link' }] as Content[])
        : []),
      {
        text: analysis ? 'AI-саммари' : 'Фрагмент исходного материала',
        style: 'label',
      },
      { text: summary, style: 'body' },
      { text: status, style: 'status' },
    )

    if (decision) {
      content.push({
        text: [
          { text: 'Решение специалиста: ', bold: true },
          decision.final_summary || decision.comment || 'Без отдельного комментария.',
        ],
        style: 'body',
      })
    }
    if (item.comment) {
      content.push({
        text: [
          { text: 'Комментарий для менеджера: ', bold: true },
          item.comment,
        ],
        style: 'comment',
      })
    }
    if (publication.tags.length) {
      content.push({
        text: `Теги: ${publication.tags.join(', ')}`,
        style: 'metadata',
      })
    }
  })

  return {
    pageSize: 'A4',
    pageMargins: [42, 48, 42, 48],
    info: {
      title: draft.title || 'Отчёт RegRadar',
      author: 'RegRadar',
      subject: 'Обзор публикаций',
    },
    content,
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.25 },
    styles: {
      brand: { color: '#4058e8', bold: true, fontSize: 15, margin: [0, 0, 0, 14] },
      title: { bold: true, fontSize: 22, margin: [0, 0, 0, 8] },
      summary: { fontSize: 11, margin: [0, 14, 0, 22] },
      itemTitle: { bold: true, fontSize: 14, margin: [0, 18, 0, 6] },
      metadata: { color: '#667085', fontSize: 8, margin: [0, 0, 0, 6] },
      link: { color: '#4058e8', fontSize: 8, margin: [0, 0, 0, 8] },
      label: { bold: true, margin: [0, 5, 0, 3] },
      body: { margin: [0, 0, 0, 8] },
      status: { color: '#344054', margin: [0, 4, 0, 8] },
      comment: { color: '#344054', margin: [12, 4, 0, 8] },
    },
    footer: (currentPage, pageCount) => ({
      text: `${currentPage} / ${pageCount}`,
      alignment: 'center',
      color: '#98a2b3',
      fontSize: 8,
    }),
  }
}

export async function downloadReportPdf(draft: ReportDraft) {
  const [pdfMakeModule, fontModule] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ])
  type PdfMake = typeof import('pdfmake/build/pdfmake')
  const pdfMake =
    (pdfMakeModule as unknown as { default?: PdfMake }).default ?? pdfMakeModule
  const fontFiles =
    (fontModule as unknown as { default?: Record<string, string> }).default ??
    (fontModule as unknown as Record<string, string>)
  pdfMake.vfs = fontFiles
  pdfMake.createPdf(reportPdfDefinition(draft)).download(reportPdfFilename())
}
