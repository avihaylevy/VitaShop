import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  /**
   * ISSUE-112 (user-chosen: a toast) — the name to WELCOME, set only when a
   * `refresh()` turns a non-authenticated session authenticated (a real
   * in-app sign-in or auto-login), never on page-load hydration of an
   * existing session, and never when the server's fail-closed branch omitted
   * the name — a welcome without a name would be the interface inventing
   * who arrived. Null when nothing is owed.
   */
  welcomeName: string | null
  dismissWelcome: () => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading')

  const [role, setRole] = useState<SessionRole | null>(null)
  const [firstName, setFirstName] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [welcomeName, setWelcomeName] = useState<string | null>(null)
  /*
   * A ref mirror of `status`, because the welcome decision must be made
   * BEFORE setState, never inside an updater — dev StrictMode double-invokes
   * updaters, and an impure one is exactly the DEC-073 drawer defect
   * (.claude/rules/browser-verification.md). Updated everywhere status is.
   */
  const statusRef = useRef<SessionStatus>('loading')

  const refresh = useCallback(async () => {
    const wasAuthenticated = statusRef.current === 'authenticated'
    const snapshot = await fetchSession()
    // ISSUE-112 — a refresh that TURNS the session authenticated is a
    // sign-in; hydration below never sets this. No name, no toast.
    if (snapshot.authenticated && !wasAuthenticated && snapshot.firstName !== null) {
      setWelcomeName(snapshot.firstName)
    }
    statusRef.current = snapshot.authenticated ? 'authenticated' : 'guest'
    setStatus(statusRef.current)
    setRole(snapshot.role)
    setFirstName(snapshot.firstName)
    setEmail(snapshot.email)
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetchSession().then((snapshot) => {
      if (cancelled) return
      statusRef.current = snapshot.authenticated ? 'authenticated' : 'guest'
      setStatus(statusRef.current)
      setRole(snapshot.role)
      setFirstName(snapshot.firstName)
      setEmail(snapshot.email)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const dismissWelcome = useCallback(() => setWelcomeName(null), [])

  const signOut = useCallback(async () => {
    await logoutRequest()
    statusRef.current = 'guest'
    // An undelivered welcome dies with the session that earned it.
    setWelcomeName(null)
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
      welcomeName,
      dismissWelcome,
    }),
    [status, role, firstName, email, refresh, signOut, welcomeName, dismissWelcome],
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

/**
 * ISSUE-148/173 — the whole session value, or null outside a provider.
 * TOLERANT deliberately: agent/profile surfaces render in component tests
 * without the session machinery, and a missing identity must degrade
 * (nameless greeting, empty email field), never throw. Review: the ONE
 * tolerant shape — per-field wrappers were dead weight beside it.
 */
export function useOptionalSession(): SessionContextValue | null {
  return useContext(SessionContext)
}
