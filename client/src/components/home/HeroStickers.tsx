import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { FOCUS_RING } from '../ui/focusRing'
import { requestAgentOpen } from '../../lib/agentOpen'

/**
 * 2026-09-06 (the user, after five mocks) — THREE LABEL STICKERS in the
 * hero's empty half: why shop here, said the way a supplement label says
 * it. Fast, easy search · Ask the assistant · The popular brands.
 *
 * Each is a real control, not decoration: the first and third link to the
 * catalogue, the second opens the assistant (lib/agentOpen.ts). The
 * accessible name is the whole sticker's text, big line first.
 *
 * Tones are the CATEGORY tones (DEC-035: tone binds to a category, never a
 * product) borrowed as a palette — vitamins, probiotics, omega — so the
 * stickers sit in the catalogue's own colours beside the photo. Fredoka
 * (font-display) for the big line, the body face for the small one.
 *
 * Tilt and the tape strip are the sticker's whole character; the hover
 * lift is motion-safe and the tilt itself is static, so reduced motion
 * loses nothing that carries meaning.
 */

const STICKER_CLASS =
  `${FOCUS_RING} group relative flex w-full flex-col sm:w-[150px] items-start rounded-[10px] px-3.5 py-3 text-start text-text-ink no-underline ` +
  'shadow-[0_2px_6px_rgba(31,37,46,0.10),inset_0_0_0_1px_rgba(31,37,46,0.06)] ' +
  // the tape strip
  "after:absolute after:-top-[7px] after:start-1/2 after:h-3 after:w-[34px] after:-ms-[17px] after:-rotate-2 after:rounded-[2px] after:border after:border-[rgba(31,37,46,0.08)] after:bg-white/55 after:content-[''] " +
  'transition-[box-shadow,transform] duration-150 ease-standard hover:shadow-[0_6px_14px_rgba(31,37,46,0.14)] motion-safe:hover:-translate-y-0.5'

const BIG_CLASS = 'block font-display text-[24px] font-semibold leading-none tracking-[-0.01em]'
const SMALL_CLASS = 'mt-1.5 block text-[13px] font-medium leading-[1.25]'

export function HeroStickers() {
  const { t } = useTranslation('catalog')
  return (
    <ul className="mt-5 flex w-full flex-wrap items-start gap-3.5 ps-0 lg:w-auto" aria-label={t('home.stickers.groupLabel')}>
      <li className="w-[calc(50%-0.4375rem)] -rotate-3 sm:w-auto">
        <Link to="/catalog" className={STICKER_CLASS} style={{ backgroundColor: 'var(--tone-vitamins)' }}>
          <span className={BIG_CLASS}>{t('home.stickers.search.big')}</span>
          <span className={SMALL_CLASS}>{t('home.stickers.search.small')}</span>
        </Link>
      </li>
      <li className="w-[calc(50%-0.4375rem)] translate-y-2 rotate-2 sm:w-auto">
        <button
          type="button"
          onClick={requestAgentOpen}
          className={STICKER_CLASS}
          style={{ backgroundColor: 'var(--tone-probiotics)' }}
        >
          <span className={BIG_CLASS}>{t('home.stickers.ask.big')}</span>
          <span className={SMALL_CLASS}>{t('home.stickers.ask.small')}</span>
        </button>
      </li>
      <li className="w-[calc(50%-0.4375rem)] -rotate-[1.5deg] sm:w-auto">
        <Link to="/catalog" className={STICKER_CLASS} style={{ backgroundColor: 'var(--tone-omega)' }}>
          <span className={BIG_CLASS}>{t('home.stickers.brands.big')}</span>
          <span className={SMALL_CLASS}>{t('home.stickers.brands.small')}</span>
        </Link>
      </li>
    </ul>
  )
}
