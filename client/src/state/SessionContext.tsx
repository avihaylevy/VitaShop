import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * Placeholder session state so the header can render explicit signed-out
 * and signed-in states. Real session hydration (`GET /api/session`, backed
 * by the DEC-018 session cookie) is not implemented — there is no server
 * endpoint for it yet, and auth (REQ-F-030…034) is still `Not implemented`
 * per STATUS.md. `signIn`/`signOut` here only flip local component state;
 * they perform no request and must not be mistaken for real authentication.
 */

type SessionContextValue = {
  isSignedIn: boolean
  signIn: () => void
  signOut: () => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [isSignedIn, setIsSignedIn] = useState(false)

  const value = useMemo<SessionContextValue>(
    () => ({
      isSignedIn,
      signIn: () => setIsSignedIn(true),
      signOut: () => setIsSignedIn(false),
    }),
    [isSignedIn],
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
