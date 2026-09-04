// Shared vitest setup — runs before EVERY test file, both projects.
//
// 🔴 THE SUITE NEVER TOUCHES A REAL AI PROVIDER (DEC-094 scar): the
// developer's .env legitimately says AI_PROVIDER=groq with a real key, and
// ../index.js resolves the provider at import time — the day the key
// landed, the integration suite hit api.groq.com and spent real quota.
// Pinning the mock HERE (not in one suite's beforeAll) covers every
// current and FUTURE test file that imports the app.
process.env.AI_PROVIDER = 'mock'
// 🔴 SAME SCAR, ONE SEAM OVER (DEC-117): index.js resolves the EMAIL
// transport at import time too. A developer's .env may say brevo with a
// real key; the suite must never send real mail to a fixture address.
process.env.EMAIL_PROVIDER = 'console'
