import { useEffect } from 'react'

/**
 * Web Interface Guidelines pass (2026-08-23) — warn before the TAB closes
 * or navigates away while a form holds unsaved work. `beforeunload` only:
 * in-app route changes are already survivable (admin drafts live in state
 * keyed by row, checkout prefills from the account), so blocking the SPA
 * router would nag more than it protects. The browser owns the dialog's
 * wording; `preventDefault` is the whole API.
 *
 * ⚠️ Attach/detach follows `dirty` so a clean form adds NO listener —
 * Chrome punishes pages that hold a permanent beforeunload handler
 * (back/forward cache disabled), which would slow every navigation to pay
 * for a warning that mostly never fires.
 */
export function useUnsavedChangesWarning(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Legacy Chromium checks that returnValue was ASSIGNED, not its truth.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
}
