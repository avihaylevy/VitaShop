import { useEffect, useRef, useState } from 'react'
import { Toast } from '../ui/Toast'

type AddedToCartToastProps = {
  /** The already-translated confirmation sentence; empty until the first add. */
  message: string
  /**
   * Retrigger key — the hook's `announced` object, whose identity changes on
   * EVERY confirmed add and on NOTHING else. 🔴 The effect keys on this
   * alone: `message` is a DERIVED string that also changes on a language
   * toggle or when the announced product leaves/re-enters the page's list,
   * and none of those is an add (review of the fifth-list diff — keying on
   * the message re-popped a stale toast on the he/en switch).
   */
  announceKey: unknown
  /**
   * True while the cart drawer is open. The drawer IS the confirmation on
   * the adds that open it (the session's first add, and every clamped or
   * refused add — DEC-073/§7.16); a toast behind its scrim would be both
   * invisible (z-40 under the z-50 overlay) and inert. The toast serves the
   * QUIET adds only.
   */
  suppress?: boolean
}

/**
 * Fifth list, item 3 — the add-to-cart confirmation POPUP. Shell and
 * live-region contract live in ui/Toast; this file owns only the policy:
 * when to show, for how long, and when the drawer outranks it.
 * 'below-header' slot: never overlaps a live WelcomeToast.
 */
export function AddedToCartToast({ message, announceKey, suppress = false }: AddedToCartToastProps) {
  const [visible, setVisible] = useState(false)
  // Read at fire time, never depended on — see the props' notes.
  const messageRef = useRef(message)
  messageRef.current = message
  const suppressRef = useRef(suppress)
  suppressRef.current = suppress

  useEffect(() => {
    if (announceKey == null || !messageRef.current || suppressRef.current) return
    setVisible(true)
    const timer = window.setTimeout(() => setVisible(false), 4000)
    return () => window.clearTimeout(timer)
  }, [announceKey])

  return (
    <Toast visible={visible && message.length > 0} slot="below-header">
      {message}
    </Toast>
  )
}
