import { useEffect, useRef, useState } from 'react'

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
 * token-bearing entry in history, which is the thing being removed. And the
 * token is captured into a ref BEFORE the replace, because after it the query
 * string is gone and there is nothing left to read.
 */
export function useUrlToken(paramName = 'token'): string | null {
  // Read synchronously during the first render: an effect would run after the
  // browser has already had the URL, and a StrictMode double-mount would find
  // the query string already stripped on the second pass.
  const captured = useRef<string | null>(null)
  const [token] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    const value = new URLSearchParams(window.location.search).get(paramName)
    captured.current = value
    return value
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
