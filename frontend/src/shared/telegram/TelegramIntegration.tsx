import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import {
  connectTelegramRuntime,
  mountTelegramRuntime,
  syncTelegramBackButton,
} from './adapter'
import type { TelegramAuthResponse } from '../api/types'

type TelegramSession =
  | { status: 'browser' }
  | { status: 'checking' }
  | { status: 'authenticated'; user: TelegramAuthResponse['user'] }
  | { status: 'rejected' }

export function TelegramIntegration() {
  const location = useLocation()
  const navigate = useNavigate()
  const [session, setSession] = useState<TelegramSession>({ status: 'browser' })

  useEffect(() => mountTelegramRuntime(), [])

  useEffect(() => {
    return connectTelegramRuntime((webApp) => {
      const initData = webApp.initData?.trim()
      if (!initData) {
        setSession({ status: 'rejected' })
        document.documentElement.dataset.telegramAuth = 'rejected'
        return clearTelegramSessionDocumentState
      }

      const controller = new AbortController()
      setSession({ status: 'checking' })
      document.documentElement.dataset.telegramAuth = 'checking'
      api.authenticateTelegram(initData, controller.signal).then(
        (result) => {
          setSession({ status: 'authenticated', user: result.user })
          document.documentElement.dataset.telegramAuth = 'authenticated'
          document.documentElement.dataset.telegramUserId = String(result.user.id)
        },
        () => {
          if (!controller.signal.aborted) {
            setSession({ status: 'rejected' })
            document.documentElement.dataset.telegramAuth = 'rejected'
            delete document.documentElement.dataset.telegramUserId
          }
        },
      )
      return () => {
        controller.abort()
        clearTelegramSessionDocumentState()
      }
    })
  }, [])

  useEffect(() => {
    const isFeed = location.pathname === '/feed'
    const hasPreviousAppRoute = location.key !== 'default'

    return syncTelegramBackButton(!isFeed, () => {
      if (hasPreviousAppRoute) navigate(-1)
      else navigate('/feed', { replace: true })
    })
  }, [location.key, location.pathname, navigate])

  if (session.status === 'browser') return null

  const label = session.status === 'authenticated'
    ? `Telegram · ${session.user.first_name}`
    : session.status === 'checking'
      ? 'Telegram · проверяем вход'
      : 'Telegram · вход не подтверждён'

  return (
    <div
      className={`telegram-session telegram-session-${session.status}`}
      role="status"
      title={session.status === 'rejected'
        ? 'Проверьте токен бота и публичный HTTPS-адрес приложения.'
        : undefined}
    >
      <span aria-hidden="true" />
      {label}
    </div>
  )
}

function clearTelegramSessionDocumentState() {
  delete document.documentElement.dataset.telegramAuth
  delete document.documentElement.dataset.telegramUserId
}
