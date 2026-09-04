export type TelegramThemeParams = {
  bg_color?: string
  header_bg_color?: string
}

export type TelegramSafeAreaInset = {
  top?: number
  right?: number
  bottom?: number
  left?: number
}

export type TelegramBackButton = {
  show?: () => void
  hide?: () => void
  onClick?: (callback: () => void) => void
  offClick?: (callback: () => void) => void
}

export type TelegramWebAppEvent =
  | 'viewportChanged'
  | 'themeChanged'
  | 'safeAreaChanged'
  | 'contentSafeAreaChanged'

export type TelegramWebApp = {
  initData?: string
  viewportHeight?: number
  viewportStableHeight?: number
  themeParams?: TelegramThemeParams
  safeAreaInset?: TelegramSafeAreaInset
  contentSafeAreaInset?: TelegramSafeAreaInset
  BackButton?: TelegramBackButton
  ready?: () => void
  expand?: () => void
  onEvent?: (event: TelegramWebAppEvent, callback: () => void) => void
  offEvent?: (event: TelegramWebAppEvent, callback: () => void) => void
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp
    }
  }
}
