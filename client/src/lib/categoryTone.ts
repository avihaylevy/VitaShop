/**
 * Category -> tone mapping. design/DESIGN_SYSTEM.md §1 (Accepted, DEC-035):
 * tone binds to Category, never to Product. Keyed by the Hebrew category
 * name as stored in the database (DEC-017).
 *
 * An unmapped category falls back to --surface-page and logs, rather than
 * rendering an arbitrary tone.
 */

export const CATEGORY_TONE: Readonly<Record<string, string>> = {
  ויטמינים: 'var(--tone-vitamins)',
  מינרלים: 'var(--tone-minerals)',
  'אומגה ושומנים': 'var(--tone-omega)',
  'חלבונים ואבקות': 'var(--tone-proteins)',
  פרוביוטיקה: 'var(--tone-probiotics)',
  'צמחי מרפא': 'var(--tone-herbs)',
}

/**
 * DEC-106 — the strong level of each tone (chips and eyebrow chips; the
 * card surfaces keep the soft level above). Derived by ONE rule from the
 * soft set — see index.css for the rule and the measured contrast.
 */
export const CATEGORY_TONE_STRONG: Readonly<Record<string, string>> = {
  ויטמינים: 'var(--tone-vitamins-strong)',
  מינרלים: 'var(--tone-minerals-strong)',
  'אומגה ושומנים': 'var(--tone-omega-strong)',
  'חלבונים ואבקות': 'var(--tone-proteins-strong)',
  פרוביוטיקה: 'var(--tone-probiotics-strong)',
  'צמחי מרפא': 'var(--tone-herbs-strong)',
}

// DEC-081 made the page ground near-white, so a page-coloured fallback
// card would vanish against it — the sunken surface keeps an unmapped
// category visibly a card, just untinted.
export const FALLBACK_TONE = 'var(--surface-sunken)'

/** Categories already warned about this session — one console.warn per distinct unmapped name. */
const warnedUnmappedCategories = new Set<string>()

export function getCategoryTone(categoryNameHe: string): string {
  const tone = CATEGORY_TONE[categoryNameHe]
  if (tone !== undefined) {
    return tone
  }

  if (import.meta.env.DEV && !warnedUnmappedCategories.has(categoryNameHe)) {
    warnedUnmappedCategories.add(categoryNameHe)
    console.warn(`getCategoryTone: unmapped category "${categoryNameHe}", falling back to page surface`)
  }

  return FALLBACK_TONE
}

/** DEC-106 — same contract as getCategoryTone, one level stronger. */
export function getCategoryToneStrong(categoryNameHe: string): string {
  const tone = CATEGORY_TONE_STRONG[categoryNameHe]
  if (tone !== undefined) {
    return tone
  }
  // getCategoryTone owns the one-per-name warning; no second copy here.
  return FALLBACK_TONE
}
