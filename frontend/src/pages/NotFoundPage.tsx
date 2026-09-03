import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <section className="not-found"><div className="not-found-orbit" aria-hidden="true"><span>4</span><i /><span>4</span></div><p className="eyebrow">Сигнал потерян</p><h1>Страница не найдена</h1><p>Этот маршрут вышел из зоны наблюдения. Вернитесь к актуальной ленте сигналов.</p><Link className="button-link" to="/feed">Открыть ленту <span aria-hidden="true">↗</span></Link></section>
  )
}
