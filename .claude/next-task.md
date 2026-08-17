# SESSION HANDOFF — M-011 the AI agent opens the next session

> Rewritten 2026-08-16 at the user's request, at the end of the session
> that fixed the stale-LAN-IP outage, shipped the SEVENTH list (DEC-087),
> MILESTONE-010 the admin module (DEC-088), DEC-089's three asks (header
> cart drawer → centred card · image by URL · multer upload), and
> MILESTONE-009 profile + the address book (DEC-090) — seven commits,
> passes 79–83.
>
> ⚠️ **The memory system is authoritative** — everything here is also in
> `operations/` and `technical/`. This file is orientation, not state.

---

## 🔴 THE USER DECIDES. NOT THE AGENT. NO EXCEPTIONS.

```
🔴 THE AI PROVIDER · THE SERVER/HOSTING · ANY API KEY · ANY PAID SERVICE ·
   ANY NEW DEPENDENCY · ANY SCHEMA OR ARCHITECTURE CHANGE ·
   anything absent from the spec and from DECISIONS.md
❌ silence is not acceptance · a general "go ahead" is not acceptance of a
   SPECIFIC provider/host/key · never obtain or configure an API key
✅ present options WITH a recommendation, wait, record the answer as a DEC
```

⚠️ The standing pattern held all session: plan as a MILESTONE_PLANS
section (Proposed) → AskUserQuestion in ONE batch at the natural decision
point → every answer recorded as a DEC → build checkpoint by checkpoint →
review (4–8 finder angles) → fix everything → commit. DEC-087..090 all
went exactly this way, each time with every recommended option taken.

---

## Orientation

```
Repository:     C:\Users\aviha\תכנות\VitaShop
Memory system:  C:\Users\aviha\תכנות\זיכרון AI\פרוייקט ECOMMERCE\
                פרוייקט Ecommerce\VitaShop-Project
HEAD:           62a88fc — M-009 profile + address book. Before it, this
                session: 592322f (cart dialog centred) · 656e1db (upload
                button) · ffd16be (DEC-089: drawer trigger + image
                URL/upload) · 5eb17ca (handoff tracked) · ceb1aee (the
                seventh list) · 795440c (M-010 admin).
Tree:           CLEAN · lock 🔓 FREE (eighty-third pass released)
Suites:         server 929 · client 1001 · tsc 0 both · builds 0
Decisions new:  DEC-087 (register club opt-in · savings display ·
                /terms) · DEC-088 (admin module, five answers) · DEC-089
                (cart drawer trigger · image by URL · multer upload —
                multer USER-APPROVED) · DEC-090 (profile + book: 3-field
                address shape with the §4.6.2 deviation RECORDED · email
                frozen · picker · hard-delete · cap 5)
Dependencies:   multer + @types/multer added (user-approved, DEC-089c).
                npm audit's 5 vulns are PRE-EXISTING (prisma dev tooling
                + nanoid), not multer's.
Running:        dev servers were LEFT UP at session end (:3000 · :5173).
                Kill by EXACT re-derived PID only (ISSUE-023).
                🔴 BOTH env files now say localhost — the machine's LAN
                IP moved off 192.168.1.120 and the old value was CORS-
                blocking everything (pass 82). For a device pass:
                ipconfig → current Wi-Fi IPv4 → client/.env
                VITE_API_BASE_URL + server/.env CLIENT_ORIGIN → restart
                both. localhost is the portable daily default.
```

Read in order: `CLAUDE.md` → `00_INDEX.md` → `operations/LOCK.md` →
`operations/STATUS.md` → `operations/CURRENT_TASK.md` →
`.claude/rules/browser-verification.md`.

---

## 🔴 THE NEXT SESSION'S ORDERED QUEUE

### 1 — M-011 THE AI AGENT (the ACTIVE task)
```
PLAN FIRST — a MILESTONE_PLANS §11 section, Proposed, AskUserQuestion on
the open decisions, THEN build. 🔴 MockProvider ONLY (DEC-014): never
obtain/generate/configure a key; the USER chooses the provider; build so
a real provider is a config exercise, not a refactor. Decisions to
bundle: ISSUE-012 (storing agent conversations — schema question, so the
user BEFORE code) · what the agent can see (catalogue? the shopper's own
orders?) · where it lives in the UI · rate limiting posture.
```

### 2 — DEPLOY LAST
```
technical/DEPLOYMENT.md. The recorded traps: CLIENT_ORIGIN (CORS) ·
the in-memory rate-limiter store · §8b UPLOADS_DIR (cwd-anchored; a
launcher with another cwd strands every uploaded image; PaaS filesystems
are EPHEMERAL — uploads vanishing on redeploy is a decision to take).
```

### Smaller owed items (fold into natural moments, don't block the queue)
```
· Field grows `multiline` and absorbs ContactPage's MessageField
· DESIGN_SYSTEM.md mid-document contrast tables still cite DEC-035 values
· checkout.integration concurrent double-submit flake — green since
  2026-08-15, keep watching
· four older link-button cousins (NotFoundPage, CartPage, CartDrawer,
  AccountMenu) could adopt ui/LinkButton
· ISSUE-051's data half: 21/49 products still goalless (health_goals)
· admin failure-message mapping ×3 and the server admin-list paging copy
  (recorded reuse findings, fold in when a page is next touched)
· GET /profile's defaultAddress is LEGACY (the picker reads the book);
  retiring the field is its own decision
```

---

## The user's own queue (no agent can do these)

```
🔴 THE SIGNED-IN BROWSER PASS — now covers, on top of the standing list:
   /account/profile (details edit + the 5-cap address book) · the
   checkout saved-address PICKER (pick → fields fill · edit → unpicks) ·
   /admin/products (table · inline price/stock · hide/return · the
   create form incl. image by URL and file upload) · the header cart
   icon opening the centred cart card · the club/dietary/brands/
   favourites/checkout/orders standing set.
   Seeded accounts: npm run seed:accounts → admin@/shopper@vitashop.local.
🔴 ISSUE-018's remainder: SVG logo + the Hebrew-wordmark decision.
🔴 ISSUE-020 — the real-device pass (fix the LAN IP first, see above).
```

---

## What this session did (detail: SESSION_LOG passes 79–83)

```
ceb1aee  THE SEVENTH LIST (docx) → ISSUE-138..140 / DEC-087: club
         opt-in checkbox at registration (in the registration
         transaction) · baseUnitPrice + clubSavings through cart/quote
         off the ONE clubPricing seam (mutation-proven) · /terms page,
         link BESIDE the consent label (the nested-interactive catch).
         8-angle review, 10 findings fixed.
795440c  M-010 ADMIN (DEC-088): product routes (list-with-inactive ·
         partial PATCH · INV-03 toggle, no DELETE route · create with
         derived immutable slug, canonical-category GATED so one create
         cannot 500 the shop catalogue) + /admin/products + /new +
         menu-as-toolbox (O3; ISSUE-141/142 accepted risks). 8-angle
         review, 10 findings fixed — incl. the gate's own === null vs
         undefined caught by a masked-assert.
ffd16be  DEC-089: header cart icon opens the DRAWER (breakpoint-cross
         close — the in-place Modal died CSS-hidden with scroll-lock
         alive) · image by URL (toImageRef, ONE rule) · multer upload
         (magic-byte SNIFFED — the claimed Content-Type is a client
         header; uploadPaths.ts owns every path fact; scoped nosniff
         static; root-relative refs — the stale-IP lesson applied).
656e1db  A visible button drives the upload (user report).
592322f  The cart dialog is a CENTRED COMPACT CARD (ui/CenterDialog,
         Drawer's sibling over the same Modal core) — user report.
62a88fc  M-009 (DEC-090): profile edit (email frozen) · the address
         book (cap-5 inside a SERIALIZABLE transaction with a P2034
         retry · exclusive default unsetting by { userId } — the
         ReadCommitted snapshot hole · hard-delete promotes newest ·
         IDOR mutation-proven) · the checkout PICKER (pick+copy share
         one fields-empty condition · editing unpicks · save-consent
         dies with its checkbox). REQ-F-051 Implemented, O1 deviation
         recorded. ~16 findings fixed/recorded.
(82nd)   The STALE-IP OUTAGE: client VITE_API_BASE_URL AND server
         CLIENT_ORIGIN both carried dead 192.168.1.120 — CORS blocked
         every fetch. Both → localhost, restart, verified.
```

---

## 🔴 Rules that BIT this session — read before writing code

The standing set (browser-verify with a CONTROL · mutation-prove AND
verify the mutation applied · never pipe before reading status · vitest
does not typecheck · lock before write · locale files via Edit only ·
`Accepted` only from the user · git-bash mangles Hebrew) all held. New
scar tissue:

```
🔴 A COUNTED-CALLS FETCH STUB GOES VACUOUS every time a mount-time fetch
   is added. The out-of-order-quotes test died this way TWICE — profile
   fetch (recorded in its own comment), then the M-009 /addresses fetch
   re-opened the identical hole. Branch the mock on URL for EVERY
   endpoint the page hits, and treat any counted-call stub as fragile
   BY KIND.
🔴 A finally THAT CAN THROW EATS THE TRY'S ASSERTION. The canonical-
   category test's cleanup delete hit an FK RESTRICT and masked the real
   red (the gate compared === null against a helper returning
   UNDEFINED). Order cleanup children-first, and remember: what a test
   reports is the LAST error, not the first.
🔴 COUNT-THEN-CREATE IS A RACE even inside a plain transaction —
   ReadCommitted predicate reads don't lock. The address cap and the
   first-row-default both needed SERIALIZABLE + a P2034 retry; the
   exclusive-default unset needed { userId } (all rows) because an
   `isDefault: true` predicate can't see a concurrent transaction's
   fresh default.
🔴 `npx tsc --noEmit` AND `tsc -b` (the build) DISAGREE — the build's
   project refs typechecked authApi.test.ts that --noEmit missed. Run
   the build, not just tsc, before claiming type-clean.
🔴 file.mimetype IS THE CLIENT'S CLAIM. Sniff the bytes. (§3.4 applies
   to admins too.)
🔴 A LINK INSIDE A <label> swallows the click-to-toggle area and embeds
   itself in the checkbox's accessible name. Links live BESIDE consent
   rows, never inside them.
🔴 Button's `loading` renders NATIVE disabled → Chromium blurs the
   focused control mid-request. Row actions that must survive use
   aria-disabled + a click guard.
🔴 THE ASYNC-CONTROL FAMILY STRUCK AGAIN ×3 in one page (delete /
   make-default / the add-that-hits-the-cap all unmount their own
   button): when success unmounts the pressed control, move focus to the
   ALWAYS-MOUNTED notice that says what happened.
```

---

## Measured at handoff

```
server 929 · client 1001 · tsc 0 both · builds 0 · HEAD 62a88fc · tree
clean · lock free · dev servers UP on localhost (:3000/:5173; kill by
EXACT PID only) · every feature milestone code-complete · the signed-in
passes are the user's · NEXT: M-011 plan (MockProvider ONLY)
```
