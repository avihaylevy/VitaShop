// MILESTONE-011 Checkpoint A — MockProvider (DEC-014: mandatory, and today
// the ONLY implementation that runs).
//
// Deterministic, zero-network, zero-key. A keyword→criteria table over the
// REAL taxonomy (the seeded rows), both languages — deliberately dumb but
// honest: it exercises every branch the route has (criteria, clarify, empty
// result via a matching-but-rare combination, and the trigger short-circuit
// happens before it is ever called).
//
// 🔴 The mock emits NAMES; criteriaMapping.ts resolves them against the
// database and drops what does not match. The mock therefore cannot invent a
// filter id any more than a real LLM could — same seam, same guarantee.
//
// 🔴 INGREDIENT VALUES ARE HEBREW FOR BOTH LANGUAGES (review finding): the
// English message keys map to the HEBREW ingredient name, because that is
// the name space the seeded ProductIngredient links actually live in — the
// English-named ActiveIngredient rows in the dev database link to ZERO
// products, so emitting "Magnesium" resolved ids whose filter matched
// nothing. The taxonomy-resolution integration test pins every value in
// these tables to ≥1 linked active product.

import type { PublicCatalogProduct } from '../catalogMapper.js'
import type { AgentLang } from './notices.js'
import type {
  AIProvider,
  ChatTurn,
  ExtractedCriteriaNames,
  ExtractionResult,
} from './provider.js'

/**
 * message keyword (lowercased substring) → the taxonomy NAME the server will
 * resolve. Ingredient names resolve by case-insensitive CONTAINS (the stored
 * rows carry qualifiers — "מגנזיום (ביסגליצינאט)"), so the bare word is the
 * right thing to emit here.
 */
const INGREDIENT_KEYWORDS: Record<string, string> = {
  'מגנזיום': 'מגנזיום',
  magnesium: 'מגנזיום',
  'ויטמין d': 'ויטמין D3',
  'vitamin d': 'ויטמין D3',
  'ויטמין c': 'ויטמין C',
  'vitamin c': 'ויטמין C',
  // ⚠️ No B12 entry: the seeded catalogue's two B12 taxonomy rows link to
  // ZERO products (the taxonomy drift guard would go red). A B12 question
  // clarifies honestly instead of promising a criterion that finds nothing.
  'אומגה 3': 'אומגה 3',
  'omega 3': 'אומגה 3',
  'omega-3': 'אומגה 3',
  'ברזל': 'ברזל',
  iron: 'ברזל',
  'סידן': 'סידן',
  calcium: 'סידן',
  'אבץ': 'אבץ',
  zinc: 'אבץ',
  'כורכום': 'כורכום',
  turmeric: 'כורכום',
  'קולגן': 'קולגן',
  collagen: 'קולגן',
  'פרוביוטי': 'פרוביוטי',
  probiotic: 'פרוביוטי',
}

const GOAL_KEYWORDS: Record<string, string> = {
  'שינה': 'שינה',
  'לישון': 'שינה',
  sleep: 'Sleep',
  'חיסון': 'חיזוק חיסון',
  'חסינות': 'חיזוק חיסון',
  immune: 'Immune Support',
  immunity: 'Immune Support',
  'אנרגיה': 'אנרגיה',
  'עייפות': 'אנרגיה',
  energy: 'Energy',
  tired: 'Energy',
  'עיכול': 'עיכול',
  digestion: 'Digestion',
  'זיכרון': 'מוח וזיכרון',
  memory: 'Brain & Memory',
  'עצמות': 'עצמות',
  bones: 'Bone Health',
  'לב': 'לב וכלי דם',
  heart: 'Heart & Blood Vessels',
  'ספורט': 'ספורט',
  sport: 'Sports',
  'עור': 'עור ושיער',
  'שיער': 'עור ושיער',
  skin: 'Skin & Hair',
  hair: 'Skin & Hair',
}

/**
 * Keyword → DosageForm ENUM directly (review finding: the previous version
 * emitted free words that a SECOND table in criteriaMapping re-translated —
 * three spellings of the same concept across three files. criteriaMapping
 * accepts enum values as-is, so the mock speaks the enum).
 */
const DOSAGE_FORM_KEYWORDS: Record<string, string> = {
  'קפסול': 'CAPSULE',
  'כמוסות': 'CAPSULE',
  capsule: 'CAPSULE',
  'טבלי': 'TABLET',
  tablet: 'TABLET',
  'טיפות': 'DROPS',
  drops: 'DROPS',
  'אבקה': 'POWDER',
  powder: 'POWDER',
  'סירופ': 'SYRUP',
  syrup: 'SYRUP',
}

// Hoisted once (review finding: Object.entries per message was pure churn).
const INGREDIENT_ENTRIES = Object.entries(INGREDIENT_KEYWORDS)
const GOAL_ENTRIES = Object.entries(GOAL_KEYWORDS)
const DOSAGE_FORM_ENTRIES = Object.entries(DOSAGE_FORM_KEYWORDS)

const DIETARY_KEYWORDS: { key: 'kosher' | 'glutenFree' | 'vegan'; words: string[] }[] = [
  { key: 'kosher', words: ['כשר', 'kosher'] },
  { key: 'glutenFree', words: ['בלי גלוטן', 'ללא גלוטן', 'gluten free', 'gluten-free'] },
  { key: 'vegan', words: ['טבעוני', 'טבעונית', 'vegan'] },
]

const IN_STOCK_KEYWORDS = ['במלאי', 'in stock', 'available now']

/** "עד 100 שקל" / "under 100" / "up to 100 ils" → priceMax "100". */
const PRICE_MAX_PATTERNS = [
  /עד\s+(\d{1,5})\s*(?:שקל|ש"ח|₪)?/,
  /(?:under|below|up to|max)\s+(\d{1,5})/,
]

/** "מעל 50" / "over 50" → priceMin "50". */
const PRICE_MIN_PATTERNS = [/מעל\s+(\d{1,5})/, /(?:over|above|at least)\s+(\d{1,5})/]

/**
 * ISSUE-150 — the last-resort PRODUCT-NAME path. When no taxonomy keyword
 * matched, the message may still be naming a product ("בריאמיל", "liposomal
 * vitamin C"). Conversational filler is stripped; whatever content remains
 * becomes `productQuery`, which Stage 2 screens with the catalogue's own q
 * rule and Stage 3 runs through the SAME free-text search /catalog uses.
 * Only when NOTHING remains does the mock still clarify.
 */
const FILLER_WORDS = new Set([
  // Hebrew: politeness, verbs of asking/showing, and generic nouns.
  'תוכל', 'תוכלי', 'להראות', 'תראה', 'תציג', 'לי', 'לנו', 'מוצרי', 'מוצרים',
  'מוצר', 'טובים', 'טוב', 'טובה', 'אני', 'רוצה', 'מחפש', 'מחפשת', 'צריך',
  'צריכה', 'משהו', 'יש', 'לכם', 'לקנות', 'בבקשה', 'תודה', 'שלום', 'היי',
  'אפשר', 'האם', 'מה', 'איזה', 'איזו', 'אילו', 'עבור', 'בשביל', 'כדאי',
  'יותר', 'הכי', 'את', 'הזה', 'זה', 'גם', 'או', 'אבל', 'רק', 'עזרה',
  'לקחת', 'עוזר',
  // English.
  'show', 'me', 'can', 'you', 'i', 'want', 'need', 'some', 'good', 'best',
  'products', 'product', 'looking', 'for', 'please', 'thanks', 'thank',
  'hi', 'hello', 'a', 'an', 'the', 'to', 'of', 'do', 'have', 'buy', 'get',
  'find', 'is', 'there', 'any', 'something', 'what', 'which', 'help',
])

function extractProductQuery(lowered: string): string | undefined {
  const tokens = lowered
    .split(/[^א-ת0-9a-z]+/)
    .filter((token) => token.length > 1 && !FILLER_WORDS.has(token))
  if (tokens.length === 0) return undefined
  // Capped: a rambling sentence is not a product name.
  return tokens.slice(0, 6).join(' ')
}

const CLARIFY_QUESTION: Record<AgentLang, string> = {
  he: 'כדי שאמצא מוצרים מתאימים — איזה רכיב, מטרה בריאותית או טווח מחיר מעניינים אותך?',
  en: 'To find matching products — which ingredient, health goal, or price range are you interested in?',
}

/**
 * 🔴 SHORT HEBREW KEYS MATCH AS WHOLE TOKENS, not substrings (review
 * finding: 'לב' fired inside 'חלבון'/'בלבד', turning a protein-powder
 * request into a heart-health filter). A token counts as a match when it
 * equals the key directly, or after stripping ONE leading particle letter
 * (ו/ב/ל/ה/מ/ש/כ — "ללב", "והלב"-style attachments; harmless for English
 * tokens, whose first letter is never in the particle set's alphabet).
 * Single-word keys of ≤4 characters take the token path — that covers the
 * 2-3 char Hebrew traps AND short English words ('iron' ⊂ "environment",
 * 'hair' ⊂ "chair"). Longer or multi-word keys keep substring matching,
 * which Hebrew prefixing needs ("לשיער" contains "שיער" — 4 chars, and the
 * token path handles it via the particle strip anyway).
 */
const HEBREW_PARTICLES = new Set(['ו', 'ב', 'ל', 'ה', 'מ', 'ש', 'כ'])

function matchesHebrewKeyword(lowered: string, keyword: string): boolean {
  if (keyword.includes(' ') || keyword.length > 4) return lowered.includes(keyword)
  const tokens = lowered.split(/[^א-ת0-9a-z"']+/)
  return tokens.some((token) => {
    if (token === keyword) return true
    return HEBREW_PARTICLES.has(token[0] ?? '') && token.slice(1) === keyword
  })
}

function firstPriceMatch(lowered: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(lowered)
    if (match) return match[1]
  }
  return undefined
}

export class MockProvider implements AIProvider {
  async extractCriteria(
    message: string,
    _history: ChatTurn[],
    lang: AgentLang,
  ): Promise<ExtractionResult> {
    const lowered = message.toLowerCase()

    const criteria: ExtractedCriteriaNames = {
      brands: [],
      ingredients: [],
      healthGoals: [],
      dosageForms: [],
    }

    for (const [keyword, name] of INGREDIENT_ENTRIES) {
      if (matchesHebrewKeyword(lowered, keyword) && !criteria.ingredients.includes(name)) {
        criteria.ingredients.push(name)
      }
    }
    for (const [keyword, name] of GOAL_ENTRIES) {
      if (matchesHebrewKeyword(lowered, keyword) && !criteria.healthGoals.includes(name)) {
        criteria.healthGoals.push(name)
      }
    }
    for (const [keyword, value] of DOSAGE_FORM_ENTRIES) {
      if (lowered.includes(keyword) && !criteria.dosageForms.includes(value)) {
        criteria.dosageForms.push(value)
      }
    }
    for (const { key, words } of DIETARY_KEYWORDS) {
      if (words.some((word) => lowered.includes(word))) criteria[key] = true
    }
    if (IN_STOCK_KEYWORDS.some((word) => lowered.includes(word))) {
      criteria.inStockOnly = true
    }

    const priceMax = firstPriceMatch(lowered, PRICE_MAX_PATTERNS)
    if (priceMax !== undefined) criteria.priceMax = priceMax
    const priceMin = firstPriceMatch(lowered, PRICE_MIN_PATTERNS)
    if (priceMin !== undefined) criteria.priceMin = priceMin

    // "Anything set at all?" — derived generically so the check can never
    // drift from the ExtractedCriteriaNames field list (review finding: the
    // previous field-by-field chain silently tested fields this mock can
    // never populate).
    const empty = Object.values(criteria).every(
      (value) => value === undefined || (Array.isArray(value) && value.length === 0),
    )

    if (empty) {
      // ISSUE-150 — before clarifying, try the message as a product NAME.
      const productQuery = extractProductQuery(lowered)
      if (productQuery !== undefined) {
        return { kind: 'criteria', criteria: { ...criteria, productQuery } }
      }
      return { kind: 'clarify', question: CLARIFY_QUESTION[lang] }
    }
    return { kind: 'criteria', criteria }
  }

  async explainProducts(
    products: PublicCatalogProduct[],
    _message: string,
    lang: AgentLang,
  ): Promise<string[]> {
    // Deterministic templates built from DTO fields ONLY — the mock has no
    // other knowledge to leak, which is exactly the honesty the plan asks
    // for. Facts still render from the DTO on the client; this string sits
    // beside the card. ⚠️ A brand without a sourced Latin form falls back to
    // its Hebrew name inside English prose — bidi isolation of that run is
    // Checkpoint B's client-side job (dir/bdi), noted here so it isn't
    // mistaken for a data error: inventing a translation is forbidden
    // (DEC-032/DEC-080).
    return products.map((product) => {
      if (lang === 'he') {
        return `${product.nameHe} מבית ${product.brandName}, בקטגוריית ${product.categoryNameHe}.`
      }
      return `${product.nameEn} by ${product.brandNameEn ?? product.brandName}, in ${product.categoryNameEn}.`
    })
  }
}
