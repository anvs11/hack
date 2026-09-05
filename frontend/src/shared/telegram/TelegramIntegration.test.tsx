import { StrictMode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '../../app/router'
import type { TelegramWebApp, TelegramWebAppEvent } from './types'

function createTelegramMock() {
  const backHandlers = new Set<() => void>()
  const eventHandlers = new Map<TelegramWebAppEvent, Set<() => void>>()
  const backButton = {
    show: vi.fn(),
    hide: vi.fn(),
    onClick: vi.fn((callback: () => void) => backHandlers.add(callback)),
    offClick: vi.fn((callback: () => void) => backHandlers.delete(callback)),
  }
  const webApp: TelegramWebApp = {
    initData: 'test-init-data',
    ready: vi.fn(),
    expand: vi.fn(),
    BackButton: backButton,
    onEvent: vi.fn((event, callback) => {
      const handlers = eventHandlers.get(event) ?? new Set()
      handlers.add(callback)
      eventHandlers.set(event, handlers)
    }),
    offEvent: vi.fn((event, callback) => eventHandlers.get(event)?.delete(callback)),
  }

  window.Telegram = { WebApp: webApp }
  return {
    webApp,
    backButton,
    backHandlers,
    pressBack() {
      backHandlers.forEach((handler) => handler())
    },
  }
}

beforeEach(() => {
  delete window.Telegram
})

afterEach(() => {
  delete window.Telegram
})

describe('Telegram router integration', () => {
  it('hides BackButton on /feed and shows the verified Telegram user', async () => {
    const telegram = createTelegramMock()
    const router = createMemoryRouter(routes, { initialEntries: ['/feed'] })

    render(<RouterProvider router={router} />)

    expect(telegram.backButton.hide).toHaveBeenCalled()
    expect(telegram.backButton.show).not.toHaveBeenCalled()
    expect(telegram.backHandlers).toHaveLength(0)
    expect(await screen.findByText('Telegram · Test')).toBeInTheDocument()
  })

  it('authenticates when the official SDK finishes loading after React', async () => {
    const sdkScript = document.createElement('script')
    sdkScript.dataset.telegramWebApp = ''
    document.head.append(sdkScript)
    const telegram = createTelegramMock()
    delete window.Telegram
    const router = createMemoryRouter(routes, { initialEntries: ['/feed'] })

    const view = render(<RouterProvider router={router} />)
    expect(screen.queryByText('Telegram · Test')).not.toBeInTheDocument()

    window.Telegram = { WebApp: telegram.webApp }
    sdkScript.dispatchEvent(new Event('load'))

    expect(await screen.findByText('Telegram · Test')).toBeInTheDocument()
    view.unmount()
    sdkScript.remove()
  })

  it('shows BackButton on a nested route and falls back to /feed for a deep link', async () => {
    const telegram = createTelegramMock()
    const router = createMemoryRouter(routes, {
      initialEntries: ['/publications/pub-001'],
    })

    render(<RouterProvider router={router} />)

    expect(telegram.backButton.show).toHaveBeenCalled()
    expect(telegram.backHandlers).toHaveLength(1)

    act(() => telegram.pressBack())
    await waitFor(() => expect(router.state.location.pathname).toBe('/feed'))
    expect(telegram.backHandlers).toHaveLength(0)
  })

  it('navigates to the previous application route when history is available', async () => {
    const telegram = createTelegramMock()
    const router = createMemoryRouter(routes, {
      initialEntries: ['/feed', '/publications/pub-001'],
      initialIndex: 1,
    })

    render(<RouterProvider router={router} />)
    act(() => telegram.pressBack())

    await waitFor(() => expect(router.state.location.pathname).toBe('/feed'))
  })

  it('keeps a single BackButton handler in StrictMode and removes it on unmount', () => {
    const telegram = createTelegramMock()
    const router = createMemoryRouter(routes, {
      initialEntries: ['/publications/pub-001'],
    })

    const view = render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    )

    expect(telegram.webApp.ready).toHaveBeenCalledTimes(1)
    expect(telegram.webApp.expand).toHaveBeenCalledTimes(1)
    expect(telegram.backHandlers).toHaveLength(1)

    view.unmount()
    expect(telegram.backHandlers).toHaveLength(0)
  })
})
