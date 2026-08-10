import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { fetchSession, logout as logoutRequest } from '../lib/authApi'

/**
 * Real session state, hydrated from the server.
 *
 * 🔴 MILESTONE-006 Checkpoint H replaced the placeholder that stood here.
 * That version's own comment said "Real session hydration (`GET /api/session`,
 * backed by the DEC-018 session cookie) is not implemented — there is no
 * server endpoint for it yet" and that `signIn`/`signOut` "perform no request
 * and must not be mistaken for real authentication". Both are now false: the
 * endpoint exists (`GET /api/auth/session`) and `signOut` really ends the
 * session.
 *
 * 🔴 The session cookie is HttpOnly, so the client CANNOT read it. Auth state
 * is only ever what the server says it is — never inferred from a cookie,
 * never cached in localStorage, and never assumed from a previous response.
 * The endpoint returns a boolean and nothing else.
 */

export type SessionStatus = 'loading' | 'authenticated' | 'guest'

type SessionContextValue = {
  status: SessionStatus
  /** Kept for the header, which predates the three-state status. */
  isSignedIn: boolean
  /** Re-reads the server's answer. Call after a successful login. */
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading')

  const refresh = useCallback(async () => {
    const authenticated = await fetchSession()
    setStatus(authenticated ? 'authenticated' : 'guest')
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetchSession().then((authenticated) => {
      if (!cancelled) setStatus(authenticated ? 'authenticated' : 'guest')
    })
    return () => {
      cancelled = true
    }
  }, [])

  const signOut = useCallback(async () => {
    await logoutRequest()
    // 🔴 Set to guest regardless of the response. A7 destroys the row
    // server-side; if the request failed the local state must still not claim
    // an authenticated session it cannot verify.
    setStatus('guest')
  }, [])

  const value = useMemo<SessionContextValue>(
    () => ({ status, isSignedIn: status === 'authenticated', refresh, signOut }),
    [status, refresh, signOut],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext)
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider')
  }
  return context
}
