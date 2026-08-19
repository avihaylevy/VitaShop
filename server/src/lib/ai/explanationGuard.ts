// MILESTONE-011 Checkpoint A — Stage 3's validation (AI_SAFETY_RULES layer 4,
// AI_AGENT_SPEC "the real defence: separating facts from prose").
//
// The LLM produces ONLY the explanation strings. This guard makes even those
// strings earn their place:
//   · exactly one per retrieved product, in order — a count mismatch rejects
//     the whole batch (empty strings render as "no explanation", never as a
//     crash or a shifted pairing);
//   · length-capped — a runaway paragraph is truncated at a word boundary;
//   · 🔴 a mention of a catalogue product ABSENT from the retrieved list
//     rejects that explanation (§11.1 Stage 3) — the model may describe what
//     Stage 2 returned, never smuggle in a product the DB did not.
//
// Pure module: the route supplies the retrieved DTOs and the full catalogue
// name list; nothing here touches the database.

import type { PublicCatalogProduct } from '../catalogMapper.js'

export const MAX_EXPLANATION_LENGTH = 300

export interface ExplanationGuardInput {
  products: PublicCatalogProduct[]
  explanations: string[]
  /** Every ACTIVE catalogue product's names — the "known universe" to screen against. */
  catalogueNames: { nameHe: string; nameEn: string }[]
}

/**
 * Returns exactly `products.length` strings. A rejected or missing
 * explanation becomes '' — the card still renders from the DTO, only the
 * accompanying prose is withheld (never the other way around).
 */
export function guardExplanations(input: ExplanationGuardInput): string[] {
  const { products, explanations, catalogueNames } = input

  // Count mismatch ⇒ the pairing is untrustworthy as a whole: explanation i
  // can no longer be assumed to describe product i, and a shifted pairing is
  // exactly the "wrong fact beside a real product" failure this guard exists
  // to stop.
  if (explanations.length !== products.length) {
    return products.map(() => '')
  }

  const retrievedNames = products.flatMap((product) => [
    product.nameHe.toLowerCase(),
    product.nameEn.toLowerCase(),
  ])

  // Names of catalogue products NOT in the retrieved list. Substring-checked
  // per explanation, case-insensitively. Two exclusions keep honest prose
  // alive:
  //  · names shorter than 4 characters — "C" or "מגן" would reject on
  //    accident;
  //  · 🔴 names that are themselves SUBSTRINGS of a retrieved name (review
  //    finding, live on the real catalogue: "מגנזיום ציטראט" ⊂ "מגנזיום
  //    ציטראט 200 מ״ג" — mentioning the retrieved long name is not a
  //    mention of the short sibling, yet raw includes() said it was and
  //    blanked the prose on the catalogue's most common query).
  const forbidden = catalogueNames
    .flatMap((entry) => [entry.nameHe.toLowerCase(), entry.nameEn.toLowerCase()])
    .filter(
      (name) =>
        name.length >= 4 &&
        !retrievedNames.includes(name) &&
        !retrievedNames.some((retrieved) => retrieved.includes(name)),
    )

  return explanations.map((raw) => {
    if (typeof raw !== 'string') return ''
    let text = raw.trim()
    if (text === '') return ''

    const loweredText = text.toLowerCase()
    if (forbidden.some((name) => loweredText.includes(name))) return ''

    if (text.length > MAX_EXPLANATION_LENGTH) {
      const cut = text.slice(0, MAX_EXPLANATION_LENGTH)
      const lastSpace = cut.lastIndexOf(' ')
      text = `${cut.slice(0, lastSpace > 0 ? lastSpace : MAX_EXPLANATION_LENGTH)}…`
    }
    return text
  })
}
