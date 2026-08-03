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
      <main id="main">{children}</main>
    </>
  )
}
