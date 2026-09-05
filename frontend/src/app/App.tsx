import { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { TelegramIntegration } from '../shared/telegram/TelegramIntegration'
import { ReportProvider, useReport, isDemoMode } from '../shared/ReportStore'
const navigation = [
  { to: '/feed', label: 'Мониторинг', icon: 'radar' },
  { to: '/digest', label: 'Отчёт', icon: 'report' },
  { to: '/regulatory-cases', label: 'Кейсы НПА', icon: 'cases' },
  { to: '/duplicates', label: 'Похожие публикации', icon: 'copy' },
  { to: '/sources', label: 'Источники', icon: 'sources' },
]
function Icon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'radar' ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <path d="m12 12 7-7" />
          <circle cx="12" cy="12" r="1" />
        </>
      ) : name === 'report' ? (
        <>
          <path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h5" />
        </>
      ) : name === 'cases' ? (
        <>
          <path d="M3 6h7l2 2h9v12H3zM9 6V3h6v5M7 13h10M7 16h6" />
        </>
      ) : name === 'copy' ? (
        <>
          <rect x="8" y="8" width="12" height="13" rx="2" />
          <path d="M15 8V3H3v13h5" />
        </>
      ) : (
        <>
          <path d="M5 12a7 7 0 0 1 7 7M5 5a14 14 0 0 1 14 14" />
          <circle cx="5" cy="19" r="1.5" />
        </>
      )}
    </svg>
  )
}
export function App() {
  return (
    <ReportProvider>
      <Workspace />
    </ReportProvider>
  )
}
function Workspace() {
  useEffect(() => {
    const previous = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    return () => {
      window.history.scrollRestoration = previous
    }
  }, [])
  const location = useLocation()
  const report = useReport()
  const section =
    navigation.find((n) => location.pathname.startsWith(n.to))?.label ??
    'Анализ публикации'
  useEffect(() => {
    document.title = `${section} — RegRadar`
    if (!location.pathname.startsWith('/feed'))
      window.scrollTo({ top: 0, behavior: 'instant' })
  }, [section, location.pathname])
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        К содержанию
      </a>
      <aside className="app-sidebar">
        <NavLink
          className="brand"
          to="/feed"
          aria-label="RegRadar — на главную"
        >
          <span className="brand-mark">
            <Icon name="radar" />
          </span>
          <strong>
            RegRadar<span className="brand-dot">.</span>
          </strong>
        </NavLink>
        <div className="workspace-label">
          <span>PR / GR</span>
          <span>Рабочее пространство</span>
        </div>
        <nav className="primary-nav" aria-label="Основные разделы">
          {navigation.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {n.to === '/digest' && (
                <span className="nav-count">{report.draft.items.length}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="local-avatar" aria-hidden="true">
            GR
          </span>
          <div>
            <strong>Рабочий обзор</strong>
            <span>
              {isDemoMode
                ? 'Демонстрационные данные'
                : 'Данные подключённого API'}
            </span>
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="app-header">
          <div className="breadcrumb">
            Рабочее пространство <span>/</span> <strong>{section}</strong>
          </div>
          <div className="header-actions">
            <span className="mode-label">
              <span aria-hidden="true" className="status-dot" />
              {isDemoMode ? 'Demo · MSW' : 'Режим API'}
            </span>
            <TelegramIntegration />
            <NavLink className="header-report" to="/digest">
              <Icon name="report" />
              Отчёт <span>{report.draft.items.length}</span>
            </NavLink>
          </div>
        </header>
        <main className="page-container" id="main-content" tabIndex={-1}>
          {report.warning && (
            <p className="inline-warning" role="alert">
              {report.warning} <NavLink to="/digest">Открыть черновик</NavLink>
            </p>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  )
}
