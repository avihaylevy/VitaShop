import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useSession } from '../../state/SessionContext'
import { Toast } from '../ui/Toast'

/**
 * ISSUE-112, second half — the transient welcome the user chose. Fires only
 * when SessionContext saw a real sign-in turn the session authenticated;
 * page-load hydration never shows it. Shell and live-region contract live
 * in ui/Toast; this file owns the policy only. 'header' slot — the
 * add-to-cart toast sits one slot lower so the two never overlap.
 */
export function WelcomeToast() {
  const { welcomeName, dismissWelcome } = useSession()
  const { t } = useTranslation('layout')

  useEffect(() => {
    if (welcomeName === null) return
    const timer = window.setTimeout(dismissWelcome, 6000)
    return () => window.clearTimeout(timer)
  }, [welcomeName, dismissWelcome])

  return (
    <Toast visible={welcomeName !== null} slot="header">
      {welcomeName !== null ? t('welcome.message', { name: welcomeName }) : ''}
    </Toast>
  )
}
