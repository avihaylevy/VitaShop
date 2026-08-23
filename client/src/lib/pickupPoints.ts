/**
 * The pickup-point list — the lecturer-fixes list (2026-08-23): choosing
 * "איסוף מנקודת חלוקה" must offer POINTS to pick from, not a free-form home
 * address ("צריך איזה משהו מתאים כמו איזור חלוקה שהמשתמש בוחר").
 *
 * Client-owned static data, deliberately: the mock store invents its
 * delivery network the same way it invents its shipping prices
 * (lib/shipping.ts) — no schema, no endpoint, no admin surface. The chosen
 * point is SUBMITTED as the order's address (line1 = the point, city = its
 * city), so the server's ADDRESS_REQUIRED contract for pickup_point is
 * untouched and the order records where the parcel goes.
 *
 * 🔴 Stored values are HEBREW (data language, like every product name);
 * the English UI translates the DISPLAY only.
 */

export interface PickupPoint {
  id: string
  nameHe: string
  nameEn: string
  cityHe: string
  cityEn: string
}

export const PICKUP_POINTS: readonly PickupPoint[] = [
  { id: 'tlv-dizengoff', nameHe: 'דיזנגוף סנטר', nameEn: 'Dizengoff Center', cityHe: 'תל אביב', cityEn: 'Tel Aviv' },
  { id: 'jlm-malha', nameHe: 'קניון מלחה', nameEn: 'Malha Mall', cityHe: 'ירושלים', cityEn: 'Jerusalem' },
  { id: 'haifa-grand', nameHe: 'גרנד קניון', nameEn: 'Grand Canyon Mall', cityHe: 'חיפה', cityEn: 'Haifa' },
  { id: 'beer-sheva-big', nameHe: 'ביג באר שבע', nameEn: 'BIG Beer Sheva', cityHe: 'באר שבע', cityEn: 'Beer Sheva' },
  { id: 'netanya-ir-yamim', nameHe: 'קניון עיר ימים', nameEn: 'Ir Yamim Mall', cityHe: 'נתניה', cityEn: 'Netanya' },
  { id: 'rg-ayalon', nameHe: 'קניון איילון', nameEn: 'Ayalon Mall', cityHe: 'רמת גן', cityEn: 'Ramat Gan' },
]

/** The submitted order address for a chosen point — Hebrew, the data language. */
export function pickupPointAddress(point: PickupPoint): {
  line1: string
  city: string
  zipCode: null
} {
  return { line1: `נקודת חלוקה — ${point.nameHe}`, city: point.cityHe, zipCode: null }
}
