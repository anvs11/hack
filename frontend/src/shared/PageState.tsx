type PageStateProps = {
  kind: 'loading' | 'error' | 'empty'
  title: string
  message: string
}
export function PageState({ kind, title, message }: PageStateProps) {
  return (
    <section className={`page-state page-state-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span className="page-state-icon" aria-hidden="true">
        {kind === 'loading' ? '···' : kind === 'error' ? '!' : '—'}
      </span>
      <div>
        <h2>{title}</h2>
        <p>{message}</p>
      </div>
    </section>
  )
}
