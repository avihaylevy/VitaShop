import { useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { Drawer } from '../ui/Drawer'
import { Modal } from '../ui/Modal'

/**
 * 🔴 Development only. Gated at the route in App.tsx behind
 * import.meta.env.DEV, which Vite replaces with `false` in a production
 * build so this module is dead code and gets tree-shaken out entirely.
 * Verified by grepping dist/ — see UI_IMPLEMENTATION_PLAN.md §13.
 *
 * It exists because `Drawer` has no real consumer until CartDrawer (build
 * order step 8), and shipping the four §8 obligations with nothing
 * exercising them is exactly the half-implementation step 4 is meant to
 * prevent. Delete this once CartDrawer lands.
 *
 * Text here is intentionally not translated: it is not product UI and
 * never reaches a user. Everything a user can see goes through i18n.
 */
export function OverlayShowcase() {
  const [modalOpen, setModalOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [emptyOpen, setEmptyOpen] = useState(false)
  const [vanishingOpen, setVanishingOpen] = useState(false)
  // Proves the return-focus fallback: this trigger removes itself on open,
  // so on close there is no trigger left and focus must land on #main.
  const [vanishingTriggerPresent, setVanishingTriggerPresent] = useState(true)

  const drawerCloseRef = useRef<HTMLButtonElement>(null)

  return (
    <div className="flex flex-col gap-6 px-7 py-8">
      <h1 className="text-2xl font-semibold text-text-ink">Overlay showcase (dev only)</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-text-ink">Modal — focus starts on the panel</h2>
        <div>
          <Button onClick={() => setModalOpen(true)}>Open modal</Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-text-ink">
          Drawer — inline-start edge, focus on the close button
        </h2>
        <div>
          <Button onClick={() => setDrawerOpen(true)}>Open drawer</Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-text-ink">Edge cases</h2>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setEmptyOpen(true)}>
            No focusable content
          </Button>
          {vanishingTriggerPresent && (
            <Button
              variant="secondary"
              onClick={() => {
                setVanishingOpen(true)
                setVanishingTriggerPresent(false)
              }}
            >
              Trigger disappears on open
            </Button>
          )}
          {!vanishingTriggerPresent && (
            <Button variant="ghost" onClick={() => setVanishingTriggerPresent(true)}>
              Restore that trigger
            </Button>
          )}
        </div>
      </section>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Modal title"
        description="Focus should be on the panel itself, so a screen reader reads the dialog and its title before any control."
      >
        <div className="flex flex-col gap-3 p-4">
          <Button onClick={() => setModalOpen(false)}>First focusable</Button>
          <Button variant="secondary">Middle</Button>
          <Button variant="ghost" onClick={() => setModalOpen(false)}>
            Last focusable
          </Button>
        </div>
      </Modal>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Drawer title"
        closeButtonRef={drawerCloseRef}
        initialFocusRef={drawerCloseRef}
      >
        <div className="flex flex-col gap-3 p-4">
          <p className="text-sm text-text-muted">
            Enters from the right in Hebrew, the left in English. Slide is suppressed under
            prefers-reduced-motion; it still opens.
          </p>
          <Button variant="secondary">A control</Button>
          <Button variant="ghost" onClick={() => setDrawerOpen(false)}>
            Last focusable
          </Button>
        </div>
      </Drawer>

      <Modal open={emptyOpen} onClose={() => setEmptyOpen(false)} title="Nothing to focus">
        <p className="p-4 text-sm text-text-muted">
          Only the close button is focusable. Tab must not escape to the inert background.
        </p>
      </Modal>

      <Drawer
        open={vanishingOpen}
        onClose={() => setVanishingOpen(false)}
        title="Trigger is gone"
      >
        <p className="p-4 text-sm text-text-muted">
          The button that opened this no longer exists. On close, focus should fall back to
          #main rather than being lost to body.
        </p>
      </Drawer>
    </div>
  )
}
