import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { TelegramIntegration } from '../shared/telegram/TelegramIntegration'

const navigation = [
  { to: '/feed', label: 'Лента' },
  { to: '/duplicates', label: 'Дубли' },
  { to: '/regulatory-cases/case-001', label: 'Кейс НПА' },
  { to: '/sources', label: 'Источники' },
  { to: '/digest', label: 'Дайджест' },
]

export function App() {
  const location = useLocation()

  return (
    <div className="app-shell">
      <header className="app-header">
        <NavLink className="brand" to="/feed" aria-label="Insight — на главную">
          <span className="brand-mark" aria-hidden="true">I<span>·</span></span>
          <strong>Insight</strong>
        </NavLink>

        <p className="product-note">
          Аналитический центр для раннего обнаружения регуляторных и репутационных сигналов
        </p>

        <div className="header-actions">
          <TelegramIntegration />
          <div className="workspace-pill">
            <span className="status-dot" aria-hidden="true" />
            Demo space
          </div>
          <a className="menu-pill" href="#primary-navigation">
            Меню <span aria-hidden="true">↘</span>
          </a>
        </div>
      </header>

      <nav className="primary-nav" id="primary-navigation" aria-label="Основные разделы">
        {navigation.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => (isActive ? 'active' : undefined)}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <main className="page-container" id="main-content" tabIndex={-1}>
        <div className="route-stage" key={location.pathname}>
          <Outlet />
        </div>
      </main>

      <footer className="app-footer">
        <span>Insight / 2026</span>
        <span>Человек принимает решение. AI подсвечивает сигнал.</span>
      </footer>
    </div>
  )
}
