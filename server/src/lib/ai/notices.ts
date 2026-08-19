// MILESTONE-011 Checkpoint A — the fixed referral notice (REQ-F-075).
//
// 🔴 FIXED TEXT, byte-for-byte from ai/AI_SAFETY_RULES.md, and it is INJECTED
// SERVER-SIDE (enforcement layer 6). The AIProvider interface has no channel
// for a notice at all — a provider cannot emit, soften, or replace this text,
// because the response field is only ever assigned from these constants.
//
// Why it is fixed: if an LLM re-phrases the notice each time, one phrasing in
// a hundred will soften it. Safety is not subject to statistical variation.
// A test pins both strings byte-for-byte.

export const REFERRAL_NOTICE = {
  he: 'המידע כאן נועד לסייע באיתור מוצרים בקטלוג בלבד ואינו מהווה ייעוץ רפואי. הסוכן אינו מחליף רופא או רוקח. במצבים רפואיים, בהיריון, בשימוש בתרופות או בחשש לתגובה בין מוצרים — יש להתייעץ עם רופא או רוקח לפני נטילת תוסף.',
  en: 'This information is intended only to help you find products in our catalog and does not constitute medical advice. This assistant is not a substitute for a physician or pharmacist. If you have a medical condition, are pregnant, take medication, or are concerned about interactions between products, consult a physician or pharmacist before taking any supplement.',
} as const

export type AgentLang = keyof typeof REFERRAL_NOTICE
