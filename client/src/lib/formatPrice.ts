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

export function formatPrice(price: string, language: 'he' | 'en'): string {
  const value = Number(price)
  return new Intl.NumberFormat(CURRENCY_LOCALE[language], {
    style: 'currency',
    currency: 'ILS',
  }).format(value)
}
