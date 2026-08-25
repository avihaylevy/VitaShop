import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Icon } from '../ui/Icon'
import { ChatBubbleIcon } from '../icons'
import { FOCUS_RING } from '../ui/focusRing'
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

  /*
   * The agent is a SHOPPER tool — it searches the catalogue. On /admin/*
   * screens it renders nothing (the user's call, 2026-08-25: the button
   * cluttered the dashboards). The gate sits AFTER every hook and returns
   * null rather than unmounting at the AppShell: the component stays
   * mounted, so a transcript survives an admin detour and is back on the
   * next shopper page.
   */
  const { pathname } = useLocation()
  if (pathname.startsWith('/admin')) return null

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
       *
       * ISSUE-144 (the eighth list): a ROUND floating pill in the agent's
       * own plum — hand-styled rather than a Button variant, because the
       * pill radius would collide with Button's baked-in rounded-card at
       * equal specificity (the exact trap Button.tsx's aria-disabled note
       * documents). The halo ring is a sibling span, transform+opacity only,
       * and motion-safe-gated; it hides while the panel is open so the
       * breathing never plays under the scrim.
       */}
      <div className="fixed bottom-4 end-4 z-30">
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 rounded-round bg-agent motion-reduce:hidden ${
            panelOpen ? 'hidden' : 'motion-safe:animate-[agent-fab-halo_3.2s_var(--ease)_infinite]'
          }`}
        />
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setPanelOpen(true)}
          className={`${FOCUS_RING} relative inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-round bg-agent px-4 text-[13px] font-semibold text-white shadow-[0_4px_14px_rgb(122_62_107/0.35)] transition-[background-color,box-shadow,transform] duration-150 ease-standard hover:-translate-y-0.5 hover:bg-agent-strong hover:shadow-[0_8px_20px_rgb(122_62_107/0.45)] active:translate-y-0 active:scale-[0.98] motion-reduce:transition-none motion-reduce:hover:translate-y-0`}
        >
          <Icon size={17}>
            <ChatBubbleIcon />
          </Icon>
          {t('button.open')}
        </button>
      </div>

      <AgentPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        // A link in the transcript left for the page. Focus returns to the
        // floating button — DELIBERATE: useReturnFocus captures its target
        // at open, the button survives the route change, and it is the
        // one-keypress way back to the conversation this widget kept. The
        // navigation itself is ANNOUNCED from the session-long region (the
        // async-control rule's other half), because nothing else in an SPA
        // route change says anything out loud.
        onNavigate={() => {
          setPanelOpen(false)
          announce(t('a11y.navigated'))
        }}
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
