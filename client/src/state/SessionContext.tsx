import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { fetchSession, logout as logoutRequest, type SessionRole } from '../lib/authApi'

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
 * The endpoint began as a bare boolean; DEC-071 added the role and ISSUE-089
 * the caller's own name and email — still only what the server says.
 */

export type SessionStatus = 'loading' | 'authenticated' | 'guest'

type SessionContextValue = {
  status: SessionStatus
  /** Kept for the header, which predates the three-state status. */
  isSignedIn: boolean
  /**
   * 🔴 DEC-071, ISSUE-097 — WHETHER TO DRAW AN ADMIN LINK, and nothing more.
   * It grants no access: every admin route re-reads `User.role` from the
   * database per request (DEC-065). `false` while loading and for any role the
   * client does not recognise, so the safe direction is the one shown.
   */
  isAdmin: boolean
  /**
   * ISSUE-089 — the signed-in caller's own identity, for the header to
   * finally SAY who is signed in. Null while loading, for guests, and on the
   * server's fail-closed branch — render nothing rather than a placeholder.
   */
  firstName: string | null
  email: string | null
  /** Re-reads the server's answer. Call after a successful login. */
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading')

  const [role, setRole] = useState<SessionRole | null>(null)
  const [firstName, setFirstName] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const snapshot = await fetchSession()
    setStatus(snapshot.authenticated ? 'authenticated' : 'guest')
    setRole(snapshot.role)
    setFirstName(snapshot.firstName)
    setEmail(snapshot.email)
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetchSession().then((snapshot) => {
      if (cancelled) return
      setStatus(snapshot.authenticated ? 'authenticated' : 'guest')
      setRole(snapshot.role)
      setFirstName(snapshot.firstName)
      setEmail(snapshot.email)
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
    // 🔴 CLEARED WITH THE SESSION. A stale `admin` here would keep drawing the
    // link for whoever uses the browser next — and while the server would
    // refuse them, the interface would be lying about who is signed in.
    // ISSUE-089: the identity goes with it, for the same reason.
    setRole(null)
    setFirstName(null)
    setEmail(null)
  }, [])

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      isSignedIn: status === 'authenticated',
      isAdmin: status === 'authenticated' && role === 'admin',
      firstName: status === 'authenticated' ? firstName : null,
      email: status === 'authenticated' ? email : null,
      refresh,
      signOut,
    }),
    [status, role, firstName, email, refresh, signOut],
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
