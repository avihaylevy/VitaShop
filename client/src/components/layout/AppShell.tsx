import type { ReactNode } from 'react'
import { SkipLink } from './SkipLink'
import { Header } from './Header'
import { MobileHeader } from './MobileHeader'

/** Mounts the skip link and both header variants once, above every route. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <SkipLink />
      <Header />
      <MobileHeader />
      {/*
        tabIndex={-1} makes <main> a real focus target without adding it to
        the tab sequence. Two things depend on it: the skip link, whose
        target must actually receive focus, and useReturnFocus's fallback
        for when an overlay's trigger has been removed before it closed.
      */}
      <main id="main" tabIndex={-1} className="focus:outline-none">
        {children}
      </main>
    </>
  )
}
