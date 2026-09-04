import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { mountTelegramRuntime, syncTelegramBackButton } from './adapter'

export function TelegramIntegration() {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => mountTelegramRuntime(), [])

  useEffect(() => {
    const isFeed = location.pathname === '/feed'
    const hasPreviousAppRoute = location.key !== 'default'

    return syncTelegramBackButton(!isFeed, () => {
      if (hasPreviousAppRoute) navigate(-1)
      else navigate('/feed', { replace: true })
    })
  }, [location.key, location.pathname, navigate])

  return null
}
