import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <section className="not-found"><p className="error-code">404</p><h1>Страница не найдена</h1><p>Проверьте адрес или вернитесь к демо-ленте.</p><Link className="button-link" to="/feed">Открыть ленту</Link></section>
  )
}
