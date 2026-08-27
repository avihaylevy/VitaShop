import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useFavourites, type FavouriteToggleResult } from '../../state/FavouritesContext'
import { IconButton } from '../ui/IconButton'
import { HeartIcon } from '../icons'

type FavouriteButtonProps = {
  slug: string
  className?: string
  /**
   * Fires with every settled toggle result except the auth redirect.
   * Reaches the favourites page through ProductGrid → ProductCard →
   * onFavouriteToggled, where a confirmed removal is announced and focus
   * is repaired after this very card unmounts.
   */
  onToggled?: (result: FavouriteToggleResult) => void
}

/**
 * ISSUE-115 / REQ-F-003 — THE one favourite heart, extracted from its two
 * verbatim copies (ProductCard, ProductDetailsPage — review of ab8e374).
 * `aria-pressed` carries the state, the label says the ACTION, HeartIcon's
 * fill mirrors it. Server-confirmed, never optimistic (DEC-047 D1's rule).
 *
 * A10 — the ACTION is gated, never the surface: a guest pressing the heart
 * is sent to /login; the catalogue stays open.
 *
 * 🔴 A FAILED toggle is SAID, not swallowed (§7.16 silent loss): the
 * PROVIDER owns one always-mounted sr-only status region app-wide and
 * announces the failure from there — never a live region per card. Success
 * on the favourites page (where the card derives out of view) is announced
 * by the PAGE's own always-mounted region, never from here.
 */
export function FavouriteButton({ slug, className = '', onToggled }: FavouriteButtonProps) {
  const { t } = useTranslation('catalog')
  const { isFavourite, toggle } = useFavourites()
  const navigate = useNavigate()
  const favourited = isFavourite(slug)

  return (
    <IconButton
      // Pass 131, the user's call: the FILLED heart is red, not ink. The
      // class rides the svg itself so it beats IconButton's inherited
      // text-text-ink without a specificity fight. --fav-heart is its own token (a true bright red — error red is
      // darkened for text contrast, which a glyph fill does not need); aria-pressed remains the semantic signal
      // (colour is never the sole indicator).
      icon={<HeartIcon filled={favourited} className={favourited ? 'text-fav-heart' : undefined} />}
      aria-pressed={favourited}
      aria-label={favourited ? t('favourite.remove') : t('favourite.add')}
      variant="ghost"
      onClick={() => {
        void toggle(slug).then((result) => {
          if (result === 'auth-required') {
            navigate('/login')
            return
          }
          onToggled?.(result)
        })
      }}
      className={className}
    />
  )
}
