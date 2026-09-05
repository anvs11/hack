import {
  Navigate,
  createBrowserRouter,
  createMemoryRouter,
  type RouteObject,
} from 'react-router-dom'
import { DigestPage } from '../pages/DigestPage'
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
      { path: 'regulatory-cases/:id', element: <RegulatoryCasePage /> },
      { path: 'sources', element: <SourcesPage /> },
      { path: 'digest', element: <DigestPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
] satisfies RouteObject[]

export const router = createBrowserRouter(routes)

export function createTestRouter(initialEntry: string) {
  return createMemoryRouter(routes, { initialEntries: [initialEntry] })
}
