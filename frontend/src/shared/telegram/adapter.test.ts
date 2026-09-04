import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getTelegramRuntimeInfo,
  mountTelegramRuntime,
} from './adapter'
import type { TelegramWebApp, TelegramWebAppEvent } from './types'

const cssProperties = [
  '--tg-viewport-height',
  '--tg-viewport-stable-height',
  '--tg-app-safe-area-inset-top',
  '--tg-app-safe-area-inset-right',
  '--tg-app-safe-area-inset-bottom',
  '--tg-app-safe-area-inset-left',
  '--tg-chrome-color',
]

function createWebApp(overrides: Partial<TelegramWebApp> = {}) {
  const handlers = new Map<TelegramWebAppEvent, Set<() => void>>()
  const webApp: TelegramWebApp = {
    initData: 'test-init-data',
    ready: vi.fn(),
    expand: vi.fn(),
    onEvent: vi.fn((event, callback) => {
      const eventHandlers = handlers.get(event) ?? new Set()
      eventHandlers.add(callback)
      handlers.set(event, eventHandlers)
    }),
    offEvent: vi.fn((event, callback) => handlers.get(event)?.delete(callback)),
    ...overrides,
  }

  return {
    webApp,
    emit(event: TelegramWebAppEvent) {
      handlers.get(event)?.forEach((handler) => handler())
    },
    listenerCount(event: TelegramWebAppEvent) {
      return handlers.get(event)?.size ?? 0
    },
  }
}

function installWebApp(webApp: TelegramWebApp) {
  window.Telegram = { WebApp: webApp }
}

beforeEach(() => {
  delete window.Telegram
  window.history.replaceState(null, '', '/')
  cssProperties.forEach((property) =>
    document.documentElement.style.removeProperty(property),
  )
  document.head.innerHTML = '<meta name="theme-color" content="#f4f6f2">'
})

describe('Telegram adapter', () => {
  it('is a safe no-op in a regular browser', () => {
    expect(getTelegramRuntimeInfo()).toEqual({
      isAvailable: false,
      hasInitData: false,
    })

    const cleanup = mountTelegramRuntime()

    expect(cleanup).toBeTypeOf('function')
    expect(() => cleanup()).not.toThrow()
    expect(document.documentElement.style.getPropertyValue('--tg-viewport-height')).toBe('')
  })

  it('ignores the SDK object when the page was not launched by Telegram', () => {
    const runtime = createWebApp({ initData: '' })
    installWebApp(runtime.webApp)

    const cleanup = mountTelegramRuntime()

    expect(getTelegramRuntimeInfo()).toEqual({
      isAvailable: false,
      hasInitData: false,
    })
    expect(runtime.webApp.ready).not.toHaveBeenCalled()
    cleanup()
  })

  it('recognizes Telegram launch parameters even before initData is available', () => {
    const runtime = createWebApp({ initData: '' })
    window.history.replaceState(null, '', '/#tgWebAppVersion=8.0&tgWebAppPlatform=ios')
    installWebApp(runtime.webApp)

    const cleanup = mountTelegramRuntime()

    expect(runtime.webApp.ready).toHaveBeenCalledTimes(1)
    expect(getTelegramRuntimeInfo().isAvailable).toBe(true)
    cleanup()
  })

  it('calls ready and expand only once for the same runtime across repeated mounts', () => {
    const { webApp } = createWebApp({ initData: 'secret-query-payload' })
    const consoleSpy = vi.spyOn(console, 'log')
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    installWebApp(webApp)

    const firstCleanup = mountTelegramRuntime()
    firstCleanup()
    const secondCleanup = mountTelegramRuntime()

    expect(webApp.ready).toHaveBeenCalledTimes(1)
    expect(webApp.expand).toHaveBeenCalledTimes(1)
    expect(getTelegramRuntimeInfo()).toEqual({
      isAvailable: true,
      hasInitData: true,
    })
    expect(consoleSpy).not.toHaveBeenCalled()
    expect(storageSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()

    secondCleanup()
  })

  it('initializes when the non-blocking official SDK finishes loading later', () => {
    const sdkScript = document.createElement('script')
    sdkScript.dataset.telegramWebApp = ''
    document.head.append(sdkScript)
    const runtime = createWebApp()
    const cleanup = mountTelegramRuntime()

    expect(runtime.webApp.ready).not.toHaveBeenCalled()
    installWebApp(runtime.webApp)
    sdkScript.dispatchEvent(new Event('load'))

    expect(runtime.webApp.ready).toHaveBeenCalledTimes(1)
    expect(runtime.listenerCount('viewportChanged')).toBe(1)

    cleanup()
    expect(runtime.listenerCount('viewportChanged')).toBe(0)
    sdkScript.remove()
  })

  it('updates valid viewport and safe-area variables and removes listeners on cleanup', () => {
    const runtime = createWebApp({
      viewportHeight: 640,
      viewportStableHeight: 620,
      contentSafeAreaInset: { top: 12, right: 8, bottom: 24, left: 8 },
    })
    installWebApp(runtime.webApp)

    const cleanup = mountTelegramRuntime()

    expect(document.documentElement.style.getPropertyValue('--tg-viewport-height')).toBe('640px')
    expect(document.documentElement.style.getPropertyValue('--tg-viewport-stable-height')).toBe('620px')
    expect(document.documentElement.style.getPropertyValue('--tg-app-safe-area-inset-bottom')).toBe('24px')

    runtime.webApp.viewportHeight = 590
    runtime.webApp.viewportStableHeight = -1
    runtime.emit('viewportChanged')
    expect(document.documentElement.style.getPropertyValue('--tg-viewport-height')).toBe('590px')
    expect(document.documentElement.style.getPropertyValue('--tg-viewport-stable-height')).toBe('620px')

    runtime.webApp.contentSafeAreaInset = { top: 18, right: 8, bottom: 30, left: 8 }
    runtime.emit('contentSafeAreaChanged')
    expect(document.documentElement.style.getPropertyValue('--tg-app-safe-area-inset-top')).toBe('18px')
    expect(document.documentElement.style.getPropertyValue('--tg-app-safe-area-inset-bottom')).toBe('30px')
    expect(runtime.listenerCount('viewportChanged')).toBe(1)

    cleanup()

    expect(runtime.listenerCount('viewportChanged')).toBe(0)
    expect(runtime.listenerCount('themeChanged')).toBe(0)
    expect(runtime.listenerCount('safeAreaChanged')).toBe(0)
    expect(runtime.listenerCount('contentSafeAreaChanged')).toBe(0)
    expect(document.documentElement.style.getPropertyValue('--tg-viewport-height')).toBe('')
  })

  it('applies only valid Telegram theme colors to browser chrome', () => {
    const runtime = createWebApp({
      themeParams: { bg_color: '#ddeeff', header_bg_color: '#aabbcc' },
    })
    installWebApp(runtime.webApp)

    const cleanup = mountTelegramRuntime()
    const themeMeta = document.querySelector('meta[name="theme-color"]')

    expect(themeMeta).toHaveAttribute('content', '#aabbcc')
    expect(document.documentElement.style.getPropertyValue('--tg-chrome-color')).toBe('#aabbcc')

    runtime.webApp.themeParams = { bg_color: 'not-a-color' }
    runtime.emit('themeChanged')
    expect(themeMeta).toHaveAttribute('content', '#aabbcc')

    runtime.webApp.themeParams = { bg_color: '#112233' }
    runtime.emit('themeChanged')
    expect(themeMeta).toHaveAttribute('content', '#112233')

    cleanup()
    expect(themeMeta).toHaveAttribute('content', '#f4f6f2')
  })

  it('tolerates a partial Telegram runtime', () => {
    installWebApp({ initData: 'test-init-data' })
    expect(() => mountTelegramRuntime()()).not.toThrow()
  })
})
