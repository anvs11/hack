import type {
  TelegramSafeAreaInset,
  TelegramWebApp,
  TelegramWebAppEvent,
} from './types'

type Cleanup = () => void

const initializedWebApps = new WeakSet<object>()
const viewportProperties = [
  '--tg-viewport-height',
  '--tg-viewport-stable-height',
] as const
const safeAreaProperties = {
  top: '--tg-app-safe-area-inset-top',
  right: '--tg-app-safe-area-inset-right',
  bottom: '--tg-app-safe-area-inset-bottom',
  left: '--tg-app-safe-area-inset-left',
} as const

function attempt(action: (() => void) | undefined) {
  try {
    action?.()
  } catch {
    // Older or partially injected clients must not prevent the web app from loading.
  }
}

function getWebApp() {
  if (typeof window === 'undefined') return undefined
  const webApp = window.Telegram?.WebApp
  if (!webApp) return undefined

  const queryParameters = new URLSearchParams(window.location.search)
  const hashParameters = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const isTelegramLaunch = Boolean(webApp.initData?.trim()) ||
    queryParameters.has('tgWebAppVersion') ||
    queryParameters.has('tgWebAppPlatform') ||
    hashParameters.has('tgWebAppVersion') ||
    hashParameters.has('tgWebAppPlatform')

  return isTelegramLaunch ? webApp : undefined
}

function withWebApp(setup: (webApp: TelegramWebApp) => Cleanup | void): Cleanup {
  let connected = false
  let cleanup: Cleanup | undefined
  const sdkScript = typeof document === 'undefined'
    ? null
    : document.querySelector<HTMLScriptElement>('script[data-telegram-web-app]')

  const connect = () => {
    if (connected) return
    const webApp = getWebApp()
    if (!webApp) return
    connected = true
    cleanup = setup(webApp) || undefined
  }

  connect()
  if (!connected) sdkScript?.addEventListener('load', connect)

  return () => {
    sdkScript?.removeEventListener('load', connect)
    cleanup?.()
  }
}

function validPixelValue(value: unknown, allowZero = false): value is number {
  return typeof value === 'number' && Number.isFinite(value) &&
    (allowZero ? value >= 0 : value > 0)
}

function setPixelProperty(property: string, value: unknown, allowZero = false) {
  if (!validPixelValue(value, allowZero)) return
  document.documentElement.style.setProperty(property, `${value}px`)
}

function applyViewport(webApp: TelegramWebApp) {
  setPixelProperty('--tg-viewport-height', webApp.viewportHeight)
  setPixelProperty('--tg-viewport-stable-height', webApp.viewportStableHeight)
}

function applySafeArea(inset: TelegramSafeAreaInset | undefined) {
  if (!inset) return
  for (const side of Object.keys(safeAreaProperties) as (keyof typeof safeAreaProperties)[]) {
    setPixelProperty(safeAreaProperties[side], inset[side], true)
  }
}

function applyTheme(webApp: TelegramWebApp) {
  const chromeColor = webApp.themeParams?.header_bg_color ?? webApp.themeParams?.bg_color
  if (!chromeColor || !/^#[\da-f]{6}$/i.test(chromeColor)) return

  document.documentElement.style.setProperty('--tg-chrome-color', chromeColor)
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', chromeColor)
}

function subscribe(
  webApp: TelegramWebApp,
  event: TelegramWebAppEvent,
  listener: () => void,
) {
  attempt(() => webApp.onEvent?.(event, listener))
  return () => attempt(() => webApp.offEvent?.(event, listener))
}

export type TelegramRuntimeInfo = {
  isAvailable: boolean
  hasInitData: boolean
}

export function getTelegramRuntimeInfo(): TelegramRuntimeInfo {
  const webApp = getWebApp()
  return {
    isAvailable: Boolean(webApp),
    hasInitData: Boolean(webApp?.initData),
  }
}

export function mountTelegramRuntime(): Cleanup {
  return withWebApp((webApp) => {
    if (!initializedWebApps.has(webApp)) {
      initializedWebApps.add(webApp)
      attempt(() => webApp.ready?.())
      attempt(() => webApp.expand?.())
    }

    const rootStyle = document.documentElement.style
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const initialThemeColor = themeMeta?.getAttribute('content') ?? null
    const properties = [
      ...viewportProperties,
      ...Object.values(safeAreaProperties),
      '--tg-chrome-color',
    ]
    const initialProperties = new Map(
      properties.map((property) => [property, rootStyle.getPropertyValue(property)]),
    )

    const updateViewport = () => applyViewport(webApp)
    const updateSafeArea = () => applySafeArea(
      webApp.contentSafeAreaInset ?? webApp.safeAreaInset,
    )
    const updateTheme = () => applyTheme(webApp)

    updateViewport()
    updateSafeArea()
    updateTheme()

    const cleanups = [
      subscribe(webApp, 'viewportChanged', updateViewport),
      subscribe(webApp, 'themeChanged', updateTheme),
      subscribe(webApp, 'safeAreaChanged', updateSafeArea),
      subscribe(webApp, 'contentSafeAreaChanged', updateSafeArea),
    ]

    return () => {
      cleanups.forEach((cleanup) => cleanup())
      initialProperties.forEach((value, property) => {
        if (value) rootStyle.setProperty(property, value)
        else rootStyle.removeProperty(property)
      })
      if (themeMeta) {
        if (initialThemeColor === null) themeMeta.removeAttribute('content')
        else themeMeta.setAttribute('content', initialThemeColor)
      }
    }
  })
}

export function syncTelegramBackButton(
  visible: boolean,
  onClick: () => void,
): Cleanup {
  return withWebApp((webApp) => {
    const backButton = webApp.BackButton
    if (!backButton) return

    if (visible) {
      attempt(() => backButton.show?.())
      attempt(() => backButton.onClick?.(onClick))
    } else {
      attempt(() => backButton.hide?.())
    }

    return () => {
      if (visible) {
        attempt(() => backButton.offClick?.(onClick))
        attempt(() => backButton.hide?.())
      }
    }
  })
}
