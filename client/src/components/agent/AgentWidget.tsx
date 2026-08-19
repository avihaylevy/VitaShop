import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import { VisuallyHidden } from '../ui/VisuallyHidden'
import { CartDrawer } from '../cart/CartDrawer'
import { useAddToCart } from '../../hooks/useAddToCart'
import { AgentPanel } from './AgentPanel'
import type { AgentEntry } from '../../lib/agentConversation'

/**
 * MILESTONE-011 Checkpoint B — the floating agent entry point (DEC-091 O2:
 * a floating button + panel on every page, like the cart — no route churn).
 * Mounted once in AppShell, AFTER <main> so the tab order stays
 * header → content → floating controls (review: mounted before <main> it
 * interposed a bottom-corner control between the header and the page).
 *
 * 🔴 The transcript lives HERE, not in the panel: closing the panel keeps
 * the conversation (the shopper peeks at a product and comes back); it dies
 * with the tab, because the server stores nothing (DEC-091 O1).
 *
 * 🔴 The live region lives here too — the panel's subtree unmounts with the
 * drawer, and an announcement region that leaves the DOM misses the very
 * outcome it was written for (review). Each announcement renders in a
 * fresh keyed node so an identical consecutive sentence still fires the
 * live region (the ISSUE-096-family silent-repeat).
 *
 * 🔴 NO NESTED MODALS (overlayStack's own contract: a real nested overlay
 * is a stop-and-ask, UI_IMPLEMENTATION_PLAN §15). When the shared cart
 * drawer opens off an agent-card add (DEC-073's first-add-of-session), the
 * agent panel CLOSES first — one modal at a time. The cart drawer's return
 * focus is the floating button, deliberately: the trigger that opened it
 * lives inside the now-closed panel, and the button is the one-keypress way
 * back into the conversation (which this widget kept).
 */
export function AgentWidget() {
  const { t, i18n } = useTranslation('agent')
  const [panelOpen, setPanelOpen] = useState(false)
  const [entries, setEntries] = useState<AgentEntry[]>([])
  const [announcement, setAnnouncement] = useState<{ id: number; text: string } | null>(null)
  const [addConfirmation, setAddConfirmation] = useState<string | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const { handleAddToCart, drawerOpen, closeDrawer, announced } = useAddToCart()

  function announce(text: string) {
    setAnnouncement((previous) => ({ id: (previous?.id ?? 0) + 1, text }))
  }

  // One modal at a time: the drawer opening closes the panel.
  useEffect(() => {
    if (drawerOpen) setPanelOpen(false)
  }, [drawerOpen])

  // 🔴 EVERY add is announced — quiet is not silent (the useAddToCart
  // contract). The name resolves from the transcript's own DTOs, per the
  // current language, exactly the way the catalogue pages resolve it from
  // their lists; the sentence is the catalogue's own addedToCart key.
  useEffect(() => {
    if (!announced) return
    const dto = entries
      .flatMap((entry) => (entry.kind === 'agent' ? entry.response.products : []))
      .find((product) => product.slug === announced.slug)
    if (!dto) return
    const name = i18n.language === 'he' ? dto.nameHe : dto.nameEn
    const sentence = t('addedToCart', { ns: 'catalog', product: name, count: announced.count })
    setAddConfirmation(sentence)
    announce(sentence)
    // `announced` is a fresh object per confirmed add — the effect fires per
    // add even when the same product is added twice.
  }, [announced]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {/* Session-long live region — mounted for the widget's whole life,
          never inside a drawer. The keyed span forces a DOM change per
          announcement so repeats are spoken. */}
      <VisuallyHidden as="p" role="status" aria-live="polite">
        {announcement !== null && <span key={announcement.id}>{announcement.text}</span>}
      </VisuallyHidden>

      {/*
       * Fixed to the inline-end bottom corner — logical properties only, so
       * it sits bottom-left in Hebrew RTL and bottom-right in English LTR.
       * z-30: above page content, below the dropdown/overlay/modal scale
       * (40/50/60), so an open drawer's scrim covers it.
       */}
      <div className="fixed bottom-4 end-4 z-30">
        <Button ref={buttonRef} variant="primary" onClick={() => setPanelOpen(true)}>
          {t('button.open')}
        </Button>
      </div>

      <AgentPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        entries={entries}
        setEntries={setEntries}
        announce={announce}
        addConfirmation={addConfirmation}
        returnFocusRef={buttonRef}
        onAddToCart={handleAddToCart}
      />

      {/* The shared cart drawer DEC-073 opens on the session's first add.
          returnFocusRef is the FLOATING BUTTON, deliberately — see the
          header note; the hook's own trigger lookup would point into the
          panel this widget just closed. */}
      <CartDrawer open={drawerOpen} onClose={closeDrawer} returnFocusRef={buttonRef} />
    </>
  )
}
