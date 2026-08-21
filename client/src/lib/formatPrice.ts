/**
 * Price formatting — design/DESIGN_SYSTEM.md §2 (Accepted, DEC-035):
 * numbers stay LTR inside RTL text, formatted via Intl.NumberFormat only,
 * never by hand.
 *
 * Input is a string (Prisma `Decimal` serialised over JSON), never a
 * number — the client must not do arithmetic on price. This function
 * only formats an already-server-computed value for display.
 */

const CURRENCY_LOCALE: Record<'he' | 'en', string> = {
  he: 'he-IL',
  en: 'en-IL',
}

// One formatter per language for the process's life — Intl.NumberFormat
// construction is the expensive half, and a catalogue page renders dozens
// of prices per pass (review).
const FORMATTERS: Record<'he' | 'en', Intl.NumberFormat> = {
  he: new Intl.NumberFormat(CURRENCY_LOCALE.he, { style: 'currency', currency: 'ILS' }),
  en: new Intl.NumberFormat(CURRENCY_LOCALE.en, { style: 'currency', currency: 'ILS' }),
}

export function formatPrice(price: string, language: 'he' | 'en'): string {
  const value = Number(price)
  // ISSUE-167 (the eleventh list): the ₪ sign FOLLOWS the number in BOTH
  // languages — en-IL's locale default put it first. Built from
  // formatToParts so the number itself still comes from Intl, never from
  // hand-formatting; only the symbol's position is ours.
  const parts = FORMATTERS[language].formatToParts(value)
  const number = parts
    .filter((part) => part.type !== 'currency' && part.type !== 'literal')
    .map((part) => part.value)
    .join('')
  const symbol = parts.find((part) => part.type === 'currency')?.value ?? '₪'
  // A non-breaking space joins number and symbol (never wraps apart);
  // he-IL embeds RLM marks in its parts — PriceBlock's dir="ltr"
  // isolation owns directionality, so the marks are stripped.
  return `${number} ${symbol}`.replace(/[‎‏]/g, '')
}
