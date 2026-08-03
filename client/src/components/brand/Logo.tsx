import { useTranslation } from 'react-i18next'
import logoTransparent from '../../assets/brand/vitashop-logo-transparent.png'
import justLogo from '../../assets/brand/just-logo.png'
import { DESKTOP_LOGO_FRAME, MOBILE_LOGO_FRAME, type LogoFrame } from './logoFrame'

type LogoProps = {
  variant?: 'full' | 'mark'
  /** Square render size in px, "mark" variant only. */
  size?: number
  className?: string
}

function Lockup({ frame, className }: { frame: LogoFrame; className: string }) {
  return (
    <span
      className={`relative inline-block overflow-hidden align-middle ${className}`}
      style={{ width: frame.wrapperWidth, height: frame.wrapperHeight }}
    >
      {/*
       * Explicit integer width/height/transform — not object-fit: cover
       * (see logoFrame.ts for why cover renders this specific asset too
       * small) and not a fractional/sub-pixel size (its own source of
       * blur, independent of any cropping approach). No width/height
       * HTML attributes are set — those would fight the CSS sizing below,
       * the same trap DESIGN_SYSTEM.md §5 already documents for the
       * pre-transparent asset.
       */}
      <img
        src={logoTransparent}
        alt=""
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          maxWidth: 'none',
          width: frame.imageWidth,
          height: frame.imageHeight,
          transform: `translate(${frame.offsetX}px, ${frame.offsetY}px)`,
        }}
      />
    </span>
  )
}

/**
 * Brand mark. `variant="full"` is the lockup (mark + wordmark) — one
 * markup pair per breakpoint (26px desktop, 21px mobile — DESIGN_SYSTEM.md
 * §5's approved visible logo height), toggled with Tailwind responsive
 * display. `variant="mark"` is the standalone symbol (`just-logo.png`) —
 * no transparent variant of it exists yet (ISSUE-018 / TASK-011 still
 * open for that), so it keeps the plain contain-fit rendering.
 *
 * The accessible name lives on this component (not the caller): the
 * lockup's pixels spell out the brand name, so it needs real alt text,
 * translated.
 */
export function Logo({ variant = 'full', size = 28, className = '' }: LogoProps) {
  const { t } = useTranslation()
  const alt = t('app.name')

  if (variant === 'mark') {
    return (
      <img
        src={justLogo}
        alt={alt}
        style={{ width: size, height: size, maxWidth: 'none', objectFit: 'contain' }}
        className={className}
      />
    )
  }

  return (
    <span role="img" aria-label={alt} className={`inline-block ${className}`}>
      <Lockup frame={MOBILE_LOGO_FRAME} className="md:hidden" />
      <Lockup frame={DESKTOP_LOGO_FRAME} className="hidden md:inline-block" />
    </span>
  )
}
