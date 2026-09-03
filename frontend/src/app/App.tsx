import { NavLink, Outlet } from 'react-router-dom'

const navigation = [
  { to: '/feed', label: 'Лента' },
  { to: '/publications/pub-001', label: 'Публикация' },
  { to: '/regulatory-cases/case-001', label: 'Кейс НПА' },
  { to: '/sources', label: 'Источники' },
  { to: '/digest', label: 'Дайджест' },
]

export function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <NavLink className="brand" to="/feed" aria-label="Insight — на главную">
          <span className="brand-mark" aria-hidden="true">
            I
          </span>
          <span>
            <strong>Insight</strong>
            <small>PR / GR intelligence</small>
          </span>
        </NavLink>

        <div className="workspace-pill">
          <span className="status-dot" aria-hidden="true" />
          Demo workspace
        </div>
      </header>

      <nav className="primary-nav" aria-label="Основные разделы">
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

      <main className="page-container" id="main-content">
        <Outlet />
      </main>
    </div>
  )
}
