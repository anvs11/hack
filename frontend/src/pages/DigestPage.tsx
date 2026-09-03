import { Link } from 'react-router-dom'
import { localDigest } from '../shared/digest'
import { PageState } from '../shared/PageState'
import { RevealText } from '../shared/RevealText'

export function DigestPage() {
  return (
    <section>
      <header className="page-heading">
        <div><p className="eyebrow">Демо-режим</p><RevealText lines={['Дайджест для', 'руководителя']} /><p className="page-description">{localDigest.label} · {localDigest.preparedFor}</p></div>
      </header>

      <aside className="contract-notice" aria-label="Статус API дайджеста"><strong>Локальный fixture</strong><p>HTTP API дайджеста ещё не утверждён. Эта страница не создаёт фиктивный endpoint.</p></aside>

      {localDigest.items.length === 0 ? (
        <PageState kind="empty" title="Дайджест пуст" message="В локальном fixture нет материалов." />
      ) : (
        <ol className="digest-list">
          {localDigest.items.map((item, index) => (
            <li key={item.id}><span className="digest-index">{String(index + 1).padStart(2, '0')}</span><div><p className="digest-label">Материал для решения</p><h2><Link to={item.href}>{item.title}<span aria-hidden="true">↗</span></Link></h2><p>{item.reason}</p></div></li>
          ))}
        </ol>
      )}
    </section>
  )
}
