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

export function ChatBubbleIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="M12 4.5c-4.6 0-8 3-8 6.8 0 2.1 1 3.9 2.7 5.1-.1.9-.5 2-1.4 2.9 1.6 0 3-.6 3.9-1.2.9.3 1.8.4 2.8.4 4.6 0 8-3 8-6.8s-3.4-7.2-8-7.2Z" />
      <line x1="8.5" y1="10" x2="15.5" y2="10" />
      <line x1="8.5" y1="13" x2="13" y2="13" />
    </svg>
  )
}

export function SparkleIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="M12 4.5 13.6 10 19 11.5 13.6 13 12 18.5 10.4 13 5 11.5 10.4 10 12 4.5Z" />
      <path d="M18.5 4.5v3" />
      <path d="M17 6h3" />
    </svg>
  )
}

export function LeafIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="M19.5 4.5c-7.5 0-13 3.5-13 9.5a5.5 5.5 0 0 0 5.5 5.5c6 0 8.5-6.5 7.5-15Z" />
      <path d="M5 20c3-4.5 6.5-7.5 10.5-9.5" />
    </svg>
  )
}

export function SendIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="M4.5 11.2 19.5 4.8c.4-.2.8.2.6.6l-6.4 15c-.2.4-.8.4-.9-.1l-1.6-5.8a.7.7 0 0 0-.5-.5L4.6 12.1c-.5-.1-.5-.7-.1-.9Z" />
      <line x1="11.3" y1="12.7" x2="15.5" y2="8.5" />
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

export function DocumentIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="M14 3.5H7.2A1.2 1.2 0 0 0 6 4.7v14.6a1.2 1.2 0 0 0 1.2 1.2h9.6a1.2 1.2 0 0 0 1.2-1.2V7.5Z" />
      <path d="M14 3.5v4h4" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="15.5" x2="13" y2="15.5" />
    </svg>
  )
}

export function FilterIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="M4 5.5h16l-6.2 7.1v5.2l-3.6 2.2v-7.4Z" />
    </svg>
  )
}

export function ArrowForwardIcon(props: IconSvgProps) {
  // Drawn pointing RIGHT (LTR forward); callers flip it in RTL with
  // rtl:-scale-x-100 so it always points "onward".
  return (
    <svg {...BASE} {...props}>
      <line x1="4" y1="12" x2="19" y2="12" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  )
}

export function EyeIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function EyeOffIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="M2.5 12S6 5.8 12 5.8c1.6 0 3 .4 4.3 1M21.5 12S18 18.2 12 18.2c-1.6 0-3-.4-4.3-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <line x1="4" y1="20" x2="20" y2="4" />
    </svg>
  )
}

export function CheckCircleIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.2 11 14.7l4.5-5" />
    </svg>
  )
}

export function GridIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <rect x="4.5" y="4.5" width="6" height="6" rx="1.2" />
      <rect x="13.5" y="4.5" width="6" height="6" rx="1.2" />
      <rect x="4.5" y="13.5" width="6" height="6" rx="1.2" />
      <rect x="13.5" y="13.5" width="6" height="6" rx="1.2" />
    </svg>
  )
}

/* ——— Area 4 (checkout, DEC-110.3) ——— */

export function TruckIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
      <path d="M15 8h4l3 3.33V17a1 1 0 0 1-1 1h-2" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
      <path d="M9 18h6" />
    </svg>
  )
}

export function PackageIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="M3.29 7 12 12l8.71-5" />
      <path d="M12 22V12" />
      <path d="m7.55 4.24 8.95 5.16" />
    </svg>
  )
}

export function StoreIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
      <path d="M2 7h20" />
      <path d="M22 7v3a2 2 0 0 1-2 2 2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7" />
    </svg>
  )
}

export function MapPinIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="M12 21s-7-5.6-7-11a7 7 0 0 1 14 0c0 5.4-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  )
}

export function CreditCardIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M2.5 10h19" />
      <path d="M6 15h4" />
    </svg>
  )
}

export function ShieldCheckIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  )
}

export function ClockIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  )
}

export function LockIcon(props: IconSvgProps) {
  return (
    <svg {...BASE} {...props}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}
