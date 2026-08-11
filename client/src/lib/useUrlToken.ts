import { useEffect, useState } from 'react'

/**
 * MILESTONE-006 Checkpoint H, clause H1 — read a token out of the URL, then
 * REMOVE IT FROM THE ADDRESS BAR.
 *
 * 🔴 WHY THIS EXISTS. Clause A4 says the plaintext token exists only in the
 * emailed link and is never logged. The verification and reset links land on
 * `/verify-email?token=…` and `/reset-password?token=…`, so on arrival that
 * plaintext is sitting in a URL — and a URL is not private:
 *
 *   · it is written to browser history, and survives the tab
 *   · it may be sent in a `Referer` header to any third-party resource the
 *     page loads
 *   · it lands in any analytics or error-reporting payload that captures
 *     `location.href`
 *   · it is visible to anyone glancing at the address bar, and gets pasted
 *     into bug reports verbatim
 *
 * This is A4's intent applied to the one surface A4 never mentions. The
 * `Referrer-Policy` in `index.html` closes the `Referer` half; this hook
 * closes the rest by replacing the entry immediately on mount.
 *
 * 🔴 `history.replaceState`, NOT `pushState` — pushState would leave the
 * token-bearing entry in history, which is the thing being removed.
 */
export function useUrlToken(paramName = 'token'): string | null {
  // 🔴 Read synchronously during the FIRST RENDER, in the state initializer —
  // not in an effect. The effect below strips the query string, so by the time
  // any effect runs the token may already be gone; a StrictMode double-mount
  // would then find nothing on its second pass and the form would break on its
  // own remount. The state holds the value from here on, which is why nothing
  // needs to re-read the URL.
  const [token] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get(paramName)
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (!url.searchParams.has(paramName)) return

    url.searchParams.delete(paramName)
    // Keep the path and any unrelated parameters; drop a trailing '?'.
    const cleaned = `${url.pathname}${url.search}${url.hash}`
    window.history.replaceState(window.history.state, '', cleaned)
  }, [paramName])

  return token
}
