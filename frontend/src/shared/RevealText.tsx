import type { CSSProperties } from 'react'

type RevealTextProps = {
  lines: string[]
  as?: 'h1' | 'h2'
  className?: string
}

export function RevealText({ lines, as: Tag = 'h1', className }: RevealTextProps) {
  return (
    <Tag className={className}>
      {lines.map((line, index) => (
        <span className="reveal-line" key={line}>
          <span style={{ '--reveal-index': index } as CSSProperties}>{line}</span>
        </span>
      ))}
    </Tag>
  )
}
