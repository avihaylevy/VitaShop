import type { ComponentPropsWithoutRef, ReactNode } from 'react'

type SurfaceVariant = 'page' | 'section' | 'header' | 'well' | 'sunken'
type SurfaceTag = 'div' | 'section' | 'article' | 'main' | 'header' | 'nav' | 'footer' | 'aside'

const VARIANT_CLASS: Record<SurfaceVariant, string> = {
  page: 'bg-surface-page',
  section: 'bg-surface-section',
  header: 'bg-surface-header',
  well: 'bg-well',
  sunken: 'bg-surface-sunken',
}

type SurfaceProps<T extends SurfaceTag> = {
  as?: T
  variant?: SurfaceVariant
  bordered?: boolean
  children: ReactNode
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'children'>

/** Generic tone-bearing container. Category tone is applied by the caller via className, never hardcoded here. */
export function Surface<T extends SurfaceTag = 'div'>({
  as,
  variant = 'section',
  bordered = false,
  className,
  children,
  ...rest
}: SurfaceProps<T>) {
  const Tag = as ?? 'div'
  return (
    <Tag
      className={`rounded-card ${VARIANT_CLASS[variant]} ${bordered ? 'border border-border-card' : ''} ${className ?? ''}`}
      {...rest}
    >
      {children}
    </Tag>
  )
}
