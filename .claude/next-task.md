# SESSION HANDOFF — LISTS 8-11 SHIPPED · FOUR DECISIONS LANDED · DEPLOY IS THE LAST MILESTONE

> Rewritten 2026-08-21, closing the session that built the user's EIGHTH
> THROUGH ELEVENTH defect lists (ISSUE-144..178), ran an 8-angle review
> (9 findings fixed, committed `275fc3b`), and then landed the user's
> four decisions (DEC-096/097/098 built; two items deferred by them).
> SESSION_LOG passes 95-101.
>
> ⚠️ **The memory system is authoritative** — everything here is also in
> `operations/` and `technical/`. This file is orientation, not state.

---

## 🔴 THE USER DECIDES. NOT THE AGENT. NO EXCEPTIONS.

```
🔴 THE SERVER/HOSTING · ANY API KEY (incl. OAuth client secrets) · ANY
   PAID SERVICE · ANY NEW DEPENDENCY · ANY SCHEMA OR ARCHITECTURE CHANGE
❌ silence is not acceptance · a general "go ahead" is not acceptance
   of a SPECIFIC host/key/dependency · never obtain or configure a key
✅ present options WITH a recommendation, wait, record the answer as a DEC
🔴 Commit-gating: build and verify, then WAIT for the user's commit word.
🔴 Never read server/.env. Tests pin AI_PROVIDER=mock (vitest.setup) —
   the user's dev server may run the REAL Groq provider; do not send it
   chat messages from browser verification (it happened twice; own it).
```

---

## Orientation

```
Repository:     C:\Users\aviha\תכנות\VitaShop
Memory system:  C:\Users\aviha\תכנות\זיכרון AI\פרוייקט ECOMMERCE\
                פרוייקט Ecommerce\VitaShop-Project
HEAD:           621d2d8 — the thirteenth list + pass-105 review fixes,
                on top of 6158d1b (DEC-096/097/098 + the twelfth list).
TREE:           CLEAN at `621d2d8` (hundred-fifth pass, 2026-08-22):
                the thirteenth list (home footer-for-stats · volume/
                weight units on card+details+CART line — cart DTO
                gained dosageForm) + the review's 8 fixes (incl. the
                whole-enum unit pin and the new admin i18n suite).
Suites:         client 1002 green (count DROPPED from 1044 by design —
                the deleted card suites) · server: ai/account/admin/
                checkout suites green; the FULL server run carries 6
                reds = ISSUE-154's live-data artifacts (see below).
Running:        the user usually keeps dev servers up (:3000/:5173,
                localhost default). Check ports before starting any.
```

Read in order: `CLAUDE.md` → `00_INDEX.md` → `operations/LOCK.md` →
`operations/STATUS.md` → `operations/CURRENT_TASK.md` →
`.claude/rules/browser-verification.md`.

---

## What works NOW (tested, not just written)

- **The agent, third generation**: plum accent family (DEC-095 tokens,
  still *Proposed*), round FAB "צריך עזרה?", floating ChatCard (Modal
  a11y intact), greeting by first name, suggestion chips through the
  one send path, typing indicator, product thumbnails on cards,
  **product-NAME search** (productQuery → the catalogue's own q engine;
  zero-match q is stripped from handoffs, gibberish still clarifies),
  recommendation posture in the Groq prompts (fixed notice + server
  medical gate untouched). Proven live once: "בריאמיל" → the product,
  with image and a real recommendation sentence.
- **Admin**: outcome messages beside the submit button (event-driven
  scroll), whole-shekel price input, per-row FULL editor (names,
  descriptions, usage, warnings, package, dietary, dosage form),
  chrome-styled filters. The user CREATED a real product with it
  (vitamin-c-liposomal, external image URL) — which is what turned
  ISSUE-154's six tests red.
- **Shop**: single-frame search focus everywhere, ₪ BEFORE the number since
  the twelfth list (both languages, NBSP-joined, full-string pins), balanced hero,
  ticket-style receipt, softened delivery estimates, cart CLEARS
  client-side after checkout (ISSUE-178).
- **Account**: reorder from order history; profile email editing
  (DEC-090 O2 amended; EMAIL_TAKEN named refusal) — ⚠️ ISSUE-179: no
  re-auth/verification on email rotation, recorded for a decision.
- **Uncommitted but verified**: drawer = quick glance (no removal);
  club joins via consent dialog / leaves via confirm, member badge in
  the menu; checkout has NO card fields (payload pinned card-free).

---

## 🔴 THE NEXT SESSION'S ORDERED QUEUE

### 0 — The user's commit word for DEC-096/097/098 + the twelfth list (tree is dirty)

### 1 — Small open items needing the user
```
· DEC-095 (agent tokens · r-full beyond §3 · 16px bubbles) — accept or
  amend; then DESIGN_SYSTEM.md §1/§3 get amended to match.
· ISSUE-154 — the imageFile basename test vs DEC-089b external URLs:
  amend the test (recommended) or forbid external image URLs. Also
  covers the 4 seedConvergence reds (admin-created row not in CSV —
  ISSUE-142's documented signal) + the search-shape red.
· ISSUE-179 — email change without re-auth: add a password-confirm /
  verification loop, or accept for the course project.
```

### 2 — DEPLOY (the last milestone; plan first → the user → build)
```
technical/DEPLOYMENT.md. The recorded traps:
· CLIENT_ORIGIN (CORS — exact origin, never *)
· the in-memory rate-limiter store (multi-instance multiplies ceilings)
· §8b UPLOADS_DIR (cwd-anchored; PaaS filesystems are EPHEMERAL — and
  the user's real product now depends on an uploaded/external image)
· GROQ_API_KEY + AI_PROVIDER + GROQ_MODEL reach the host env — the
  user sets them PERSONALLY; missing key = loud mock fallback
· trust proxy (index.ts's comment) becomes LOAD-BEARING behind a proxy
```

### Deferred BY THE USER to after deployment (do not build before)
```
· ISSUE-160 — hard delete (options A/B/C in SESSION_LOG pass 98)
· ISSUE-163 — Google OAuth sign-up (their credentials; redirect URIs
  want the deployed origin; likely schema change)
· the save-card option (DEC-098 explicitly defers it; schema+privacy)
```

### Smaller owed items (fold into natural moments, don't block)
```
· Recorded-skipped cleanups (ISSUES.md pass-100 section): ChatCard/
  Drawer presence dedup · plum-recipe const · chrome-const share ·
  mock tokenizer unification · AgentGreeting subscription split ·
  productQuery 80-char silent drop
· ISSUE-161's full concept: a RANKED "top pick" from the provider
  (validated against retrieved rows only) — plan as its own checkpoint
· NER-grade redaction · withTimeout unification · ISSUE-051 data half ·
  ISSUE-024's Open-table/closed-index contradiction (re-derive from its
  status block) · Phase-1 spec questions (002/003/005/009/010)
```

---

## The user's own queue (no agent can do these)

```
🔴 THE SIGNED-IN BROWSER PASS — now also covers: the club consent/leave
   dialogs + menu badge · the admin full editor + dosage fix · reorder ·
   profile email change · the card-less payment + ticket receipt · the
   agent against the REAL Groq provider (they run AI_PROVIDER=groq).
   Seeded accounts: npm run seed:accounts → admin@/shopper@vitashop.local.
🔴 DEPLOY DECISIONS — host/platform is theirs; present options with a
   recommendation first.
🔴 ISSUE-018's remainder (SVG logo + Hebrew wordmark) · ISSUE-020's
   real-device pass (LAN-IP recipe: SESSION_LOG pass 82).
```

---

## 🔴 Rules that BIT this session — read before writing code

```
🔴 THE PIPE TRAP STRUCK AGAIN (browser-verification.md's own rule):
   `tsc -b 2>&1 | head; echo $?` printed 0 over a FAILING tsc — $? was
   head's. Run compilers bare or capture to a file and read $? first.
🔴 THE EFFECT-ON-VALUE SCROLL/FETCH FAMILY: two instances — an outcome
   scrollIntoView keyed on [failureText, created] scrolled to a STALE
   success; a load effect keyed on sessionEmail refetched and CLOBBERED
   the form. Side effects fire from the EVENT, not from watching state.
🔴 ONE IN-FLIGHT FLAG PER SEND PATH: the composer's local inFlight
   couldn't see the chips' turn — two concurrent sends forked the chat
   history. The panel's single `awaiting` gates BOTH now.
🔴 A PARAM-COUNT PROXY IS NOT A DECISION: `handoffParams.length === 1`
   for "only q" broke the moment q rode with one more criterion; decide
   on the resolved struct itself.
🔴 jsdom lacks matchMedia AND scrollIntoView — usePresence's CLOSE path
   calls matchMedia, so the first test to close a presence dialog needs
   the stub (pattern: useAddToCart.test.tsx).
🔴 Tolerant hooks (useOptionalSession / useCartRefresh /
   useOptionalCartClubMember) exist so provider-less test harnesses
   don't throw — ONE optional hook per context; no per-field wrappers.
🔴 i18next locale JSONs are rewritten via python json (2-indent,
   ensure_ascii=False) — keep diffs 2-line minimal; key SYMMETRY he/en
   is pinned by the integrity suites.
```

---

## Measured at handoff

```
HEAD 275fc3b · working tree DIRTY with exactly the DEC-096/097/098 set
(the user's commit word pending) · client 1002 · targeted server suites
green · full-server 6 reds = ISSUE-154 (recorded, user's call) · tsc 0
both · builds 0 both · lock FREE · deploy is the last milestone.
```
