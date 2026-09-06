import type { Priority, PublicationDetail } from './api/types'

const priorityOrder: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  unknown: 4,
}

export function sortPublications(items: PublicationDetail[]) {
  return [...items].sort((left, right) => {
    const dateDifference = Date.parse(right.publication.published_at) -
      Date.parse(left.publication.published_at)

    if (dateDifference !== 0) return dateDifference

    const leftPriority = left.latest_analysis?.proposed_priority ?? 'unknown'
    const rightPriority = right.latest_analysis?.proposed_priority ?? 'unknown'
    const priorityDifference = priorityOrder[leftPriority] - priorityOrder[rightPriority]

    if (priorityDifference !== 0) return priorityDifference
    return left.publication.id.localeCompare(right.publication.id)
  })
}
