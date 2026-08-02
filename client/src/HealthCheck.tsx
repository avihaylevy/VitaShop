import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiBaseUrl } from './lib/apiBaseUrl'

type Status = 'checking' | 'connected' | 'disconnected'

// Temporary — proves client/server wiring for MILESTONE-002. Remove once a
// real page depends on server data.
export function HealthCheck() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<Status>('checking')

  useEffect(() => {
    let cancelled = false

    fetch(`${apiBaseUrl}/api/health`)
      .then((res) => {
        if (!res.ok) throw new Error('non-ok response')
        return res.json()
      })
      .then((data: { status?: string }) => {
        if (!cancelled) setStatus(data.status === 'ok' ? 'connected' : 'disconnected')
      })
      .catch(() => {
        if (!cancelled) setStatus('disconnected')
      })

    return () => {
      cancelled = true
    }
  }, [])

  return <p>{t(`health.${status}`)}</p>
}
