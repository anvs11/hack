import type { Category, Priority } from './api/types'

const categoryLabels: Record<Category, string> = {
  regulation: 'Регуляторика',
  reputation: 'Репутация',
  competitor: 'Конкуренты',
  trend: 'Тренды',
  unknown: 'Не определено',
}
const priorityLabels: Record<Priority, string> = {
  critical: 'Критический',
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
  unknown: 'Не определено',
}

export function formatCategory(category: Category) {
  return categoryLabels[category]
}

export function formatPriority(priority: Priority) {
  return priorityLabels[priority]
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
