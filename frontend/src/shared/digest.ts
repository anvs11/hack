export type DigestItem = {
  id: string
  title: string
  reason: string
  href: string
}

export type LocalDigest = {
  label: string
  preparedFor: string
  items: DigestItem[]
}

export const localDigest = {
  label: 'Демо-дайджест · 1 сентября 2026',
  preparedFor: 'Руководитель GR/PR',
  items: [
    {
      id: 'digest-pub-001',
      title: 'Проект требований к обработке данных вынесен на обсуждение',
      reason: 'Нужно проверить применимость требований и срок подачи замечаний.',
      href: '/publications/pub-001',
    },
    {
      id: 'digest-case-001',
      title: 'Демонстрационные требования к обработке данных',
      reason: 'Кейс находится на стадии проекта; lifecycle подтверждён регуляторным источником.',
      href: '/regulatory-cases/case-001',
    },
  ],
} satisfies LocalDigest
