import {
  Navigate,
  createBrowserRouter,
  createMemoryRouter,
  type RouteObject,
} from 'react-router-dom'
import { ReportPage } from '../pages/ReportPage'
import { RegulatoryCasesPage } from '../pages/RegulatoryCasesPage'
import { DuplicatesPage } from '../pages/DuplicatesPage'
import { FeedPage } from '../pages/FeedPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { PublicationPage } from '../pages/PublicationPage'
import { RegulatoryCasePage } from '../pages/RegulatoryCasePage'
import { SourcesPage } from '../pages/SourcesPage'
import { App } from './App'

export const routes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/feed" replace /> },
      { path: 'feed', element: <FeedPage /> },
      { path: 'duplicates', element: <DuplicatesPage /> },
      { path: 'publications/:id', element: <PublicationPage /> },
      { path: 'regulatory-cases', element: <RegulatoryCasesPage /> },
      { path: 'regulatory-cases/:id', element: <RegulatoryCasePage /> },
      { path: 'sources', element: <SourcesPage /> },
      { path: 'digest', element: <ReportPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
] satisfies RouteObject[]

export const router = createBrowserRouter(routes)

export function createTestRouter(initialEntry: string) {
  return createMemoryRouter(routes, { initialEntries: [initialEntry] })
}
