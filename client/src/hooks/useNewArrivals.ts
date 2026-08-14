import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchCatalogProducts } from '../lib/catalogApi'
import { mapCatalogProduct } from '../lib/mapCatalogProduct'
import type { CatalogProductDto } from '../types/catalog'
import type { ProductCardModel } from '../types/product'
import type { SupportedLanguage } from '../i18n'

/**
 * MILESTONE-008 Checkpoint F4 — DEC-064's NEW ARRIVALS, resolving ISSUE-054.
 *
 * 🔴 WHY "NEWEST" AND NOT "BEST SELLERS". DEC-064 rejected best sellers
 * because `sort=popularity` exists but the seed has ZERO orders, so every
 * product scores 0 and the result is the tie-break order wearing a meaningful
 * label. The decision calls that the same failure as a blank warnings field
 * reading as "no warnings" — a label asserting what the data cannot support.
 * `createdAt` is real, so this label means exactly what it says.
 *
 * ⚠️ `sort=newest` IS ALREADY THE SERVER'S DEFAULT and needs no new endpoint.
 * This hook adds no server surface at all.
 */

/**
 * How many the shelf shows.
 *
 * ⚠️ THIS COMMENT USED TO CLAIM "four fits one row at every documented width",
 * WHICH IS FALSE. `ProductGrid` renders 1 column below 420px, 2 from 420, 3
 * from 1024 and 4 from 1280 — so four cards are four rows on a phone, two rows
 * from 420 to 1023, and 3 + 1 ORPHAN from 1024 to 1279. Only at 1280 and above
 * is it one row.
 *
 * 🔴 Four is kept because it fills the widest row and tiles evenly at the two
 * commonest widths; the orphan between 1024 and 1279 is accepted and named. A
 * label asserting what the layout cannot support is the defect class DEC-064's
 * own note describes, and this comment was an instance of it.
 */
export const NEW_ARRIVALS_COUNT = 4

export type NewArrivalsState =
  | { status: 'loading' }
  | { status: 'ready'; products: readonly ProductCardModel[] }
  /**
   * 🔴 A FAILURE HERE MUST NOT TAKE THE HOME PAGE DOWN. The categories are the
   * page's actual navigation; new arrivals are a shelf on top of it. The same
   * rule the checkout screen applies to the profile pre-fill — a convenience
   * that fails is a missing convenience, not a broken page.
   */
  | { status: 'failed' }

export function useNewArrivals(): NewArrivalsState & { retry: () => void } {
  const { i18n } = useTranslation()
  const language = i18n.language as SupportedLanguage

  /**
   * 🔴 THE DTOs ARE HELD, NOT THE MAPPED CARDS, and language is NOT a fetch
   * trigger — `useCatalogData` established both and this hook did neither.
   *
   * The DTO carries `nameHe` AND `nameEn`, so a language toggle needs no
   * network at all. Re-fetching on `language` blanked a loaded shelf to
   * "Loading new products…" and re-requested 24 products for data already in
   * memory — and if the network dropped in between, the toggle turned a
   * working shelf into an error. A language switch must not be a way to lose
   * content.
   */
  const [dtos, setDtos] = useState<{ status: 'loading' } | { status: 'ready'; items: CatalogProductDto[] } | { status: 'failed' }>({
    status: 'loading',
  })
  const requestId = useRef(0)

  const load = useCallback(async (signal?: AbortSignal) => {
    const id = ++requestId.current
    setDtos({ status: 'loading' })
    try {
      /*
       * ⚠️ THE SERVER HAS NO PAGE-SIZE PARAMETER — `PAGE_SIZE` is frozen at 24
       * in `catalogPagination.ts`, and §4/§4a froze the query contract. So one
       * page arrives and four are shown.
       *
       * 🔴 ADDING A `limit` PARAMETER WAS REJECTED, not overlooked: it changes
       * a frozen API contract for a home-page shelf, and an API change is a
       * stop-and-ask in this project.
       */
      const envelope = await fetchCatalogProducts(new URLSearchParams({ sort: 'newest' }), signal)
      if (id !== requestId.current) return
      /*
       * 🔴 ONLY THE FETCH IS INSIDE THE TRY. A bare catch around the mapping
       * as well would report a programming error — `mapCatalogProduct`
       * throwing on an unexpected language tag, say — as "the new products
       * could not be loaded", disguising a bug as a network failure.
       */
      setDtos({ status: 'ready', items: envelope.items.slice(0, NEW_ARRIVALS_COUNT) })
    } catch {
      if (id !== requestId.current) return
      setDtos({ status: 'failed' })
    }
  }, [])

  useEffect(() => {
    // 🔴 ABORTED ON CLEANUP, like every other fetch hook here. The requestId
    // guard suppresses a SUPERSEDED result; it does not stop an unmounted
    // component's request from running to completion.
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const retry = () => void load()

  if (dtos.status === 'ready') {
    // Mapped at RENDER, so the toggle is instant and costs no request.
    return {
      status: 'ready',
      products: dtos.items.map((dto) => mapCatalogProduct(dto, language)),
      retry,
    }
  }
  return { status: dtos.status, retry }
}
