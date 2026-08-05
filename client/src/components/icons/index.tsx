import type { SVGProps } from 'react'

/**
 * Hand-written line icons — 24×24 viewBox, `currentColor` stroke, no fill.
 * No icon-library dependency is approved (UI_IMPLEMENTATION_PLAN.md §15),
 * and ui-ux-pro-max's accessibility floor bans emoji as icons. Every icon
 * here is purely decorative on its own — the accessible name always comes
 * from the control that hosts it (via `Icon`'s aria-hidden wrapper or the
 * control's own aria-label), never from the SVG.
 */

type IconSvgProps = SVGProps<SVGSVGElement>

const BASE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function HamburgerIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  )
}

export function CloseIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <line x1="5" y1="5" x2="19" y2="19" />
      <line x1="19" y1="5" x2="5" y2="19" />
    </svg>
  )
}

export function SearchIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="20" y1="20" x2="15.3" y2="15.3" />
    </svg>
  )
}

export function HeartIcon({ filled = false, ...props }: IconSvgProps & { filled?: boolean }) {
  return (
    <svg {...BASE} fill={filled ? 'currentColor' : 'none'} {...props}>
      <path d="M12 20.2c-.28 0-.55-.09-.77-.26C7.1 16.9 3.5 13.7 3.5 9.7 3.5 6.9 5.7 4.7 8.4 4.7c1.5 0 2.9.7 3.6 1.9.7-1.2 2.1-1.9 3.6-1.9 2.7 0 4.9 2.2 4.9 5 0 4-3.6 7.2-7.73 10.24-.22.17-.49.26-.77.26Z" />
    </svg>
  )
}

export function CartIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <circle cx="9.5" cy="20" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="20" r="1.4" fill="currentColor" stroke="none" />
      <path d="M3 4h2.2l1.7 10.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 1.96-1.6L20.5 8H6.4" />
    </svg>
  )
}

export function UserIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <circle cx="12" cy="8.2" r="3.4" />
      <path d="M5 19.5c1.2-3.4 4-5 7-5s5.8 1.6 7 5" />
    </svg>
  )
}

export function GlobeIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <circle cx="12" cy="12" r="8.2" />
      <ellipse cx="12" cy="12" rx="3.4" ry="8.2" />
      <line x1="3.9" y1="9.5" x2="20.1" y2="9.5" />
      <line x1="3.9" y1="14.5" x2="20.1" y2="14.5" />
    </svg>
  )
}

export function ChevronDownIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

export function MinusIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <line x1="6" y1="12" x2="18" y2="12" />
    </svg>
  )
}

export function PlusIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <line x1="6" y1="12" x2="18" y2="12" />
      <line x1="12" y1="6" x2="12" y2="18" />
    </svg>
  )
}

export function TrashIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <line x1="4" y1="7" x2="20" y2="7" />
      <path d="M9 7V5.2A1.2 1.2 0 0 1 10.2 4h3.6A1.2 1.2 0 0 1 15 5.2V7" />
      <path d="M6.4 7l.8 11.4A1.7 1.7 0 0 0 8.9 20h6.2a1.7 1.7 0 0 0 1.7-1.6L17.6 7" />
      <line x1="10.4" y1="10.6" x2="10.7" y2="16.6" />
      <line x1="13.6" y1="10.6" x2="13.3" y2="16.6" />
    </svg>
  )
}
