import type { ReactNode } from 'react'
import { SkipLink } from './SkipLink'
import { Header } from './Header'
import { MobileHeader } from './MobileHeader'
import { WelcomeToast } from './WelcomeToast'
import { AgentWidget } from '../agent/AgentWidget'

/** Mounts the skip link and both header variants once, above every route. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <SkipLink />
      <Header />
      <MobileHeader />
      <WelcomeToast />
      {/*
        tabIndex={-1} makes <main> a real focus target without adding it to
        the tab sequence. Two things depend on it: the skip link, whose
        target must actually receive focus, and useReturnFocus's fallback
        for when an overlay's trigger has been removed before it closed.
      */}
      <main id="main" tabIndex={-1} className="focus:outline-none">
        {children}
      </main>
      {/* MILESTONE-011 / DEC-091 O2 — the agent rides the shell like the
          cart: available on every page, gated by nothing (REQ-F-070).
          AFTER <main>, so the tab order reads header → content → floating
          control instead of teleporting to the bottom corner before the
          page (review — WCAG 2.4.3). */}
      <AgentWidget />
    </>
  )
}
