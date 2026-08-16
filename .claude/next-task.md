# SESSION HANDOFF — M-010 the admin module opens the next session

> Written 2026-08-15 at the user's request, at the end of the session that
> ran the ENRICHMENT WAVE end to end (DEC-083 dietary flags + all four
> sourcing batches, 49/49), landed the DEC-078 filters, closed the SIXTH
> defect list (DEC-084 fallback gate · brand labels Latin per DEC-085),
> and PLANNED + BUILT MILESTONE-012, the membership club (DEC-086,
> checkpoints A–D, code-complete) — eleven commits, passes 67–77.
>
> ⚠️ **Untracked scratch. The memory system is authoritative** — everything
> here is also in `operations/` and `technical/`. Delete this file once
> `CURRENT_TASK.md` moves past this list.

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

⚠️ This session the user again delegated freely — AskUserQuestion in
batches at natural decision points worked EVERY time (DEC-083 schema;
DEC-084 empty-state; DEC-086's four club answers in one sitting). Standing
pattern: **"continue with X" → build → review → commit**; schema questions
go to the user BEFORE code, always.

---

## Orientation

```
Repository:     C:\Users\aviha\תכנות\VitaShop
Memory system:  C:\Users\aviha\תכנות\זיכרון AI\פרוייקט ECOMMERCE\
                פרוייקט Ecommerce\VitaShop-Project
HEAD:           90515bc — M-012 C+D (club display). Before it, this
                session: 56e305c (club B) · ed809b3 (club A) · b51dd88
                (DEC-085 Latin brands) · 979f488 · 98e1df0 (sixth list) ·
                80383c1/ab949f8/cd6499e/03fb958 (the enrichment wave) —
                plus a memory-hygiene pass (seventy-seventh) that
                compressed CURRENT_TASK/STATUS/ISSUES.
Tree:           CLEAN · lock 🔓 FREE (seventy-seventh pass released)
Suites:         server 886 · client 975 · tsc 0 both · builds 0
Migrations NEW: 20260815120000_product_dietary_flags ·
                20260815150000_user_club_membership
Decisions new:  DEC-083 dietary booleans · DEC-084 fallback suppressed
                under panel filters · DEC-085 brand Latin-first
                everywhere · DEC-086 the club (flat 10% · opt-in ·
                cart+checkout display)
Running:        dev servers left UP — server :3000 · client :5173 (PIDs
                changed during the session; re-derive with
                Get-NetTCPConnection, kill by EXACT PID only).
                🔴 open http://192.168.1.120:5173 — NOT localhost
                (DEC-010) · npm run seed:accounts for admin@/shopper@
```

Read in order: `CLAUDE.md` → `00_INDEX.md` → `operations/LOCK.md` →
`operations/STATUS.md` → `operations/CURRENT_TASK.md` →
`.claude/rules/browser-verification.md`.

---

## 🔴 THE NEXT SESSION'S ORDERED QUEUE

### 1 — M-010 THE ADMIN MODULE (ISSUE-111 is the user's own scope list)
```
PLAN FIRST — a MILESTONE_PLANS.md section, Proposed, AskUserQuestion on
the open decisions, THEN build. Scope the user named: product CRUD
(soft-delete per INV-03) · stock updates · price updates · hide shopper
entries from the admin menu. Admin is DELIBERATELY PLAIN (brief answer
12). Also belongs here: ISSUE-103's tracking-number writer already
shipped — check its admin-input half; ISSUE-101 (may a SUSPENDED shopper
read their own history?) is a decision to bundle into the plan.
🔴 THE OBVIOUS TRAP TO PUT TO THE USER: DEC-076 makes the CSV the dev
   authority and the seed CONVERGES price/stock/description — an admin
   edit a re-seed silently reverts is the contradiction the plan must
   resolve (options: CSV export? admin-wins columns? accept-and-document?).
🔴 Admin routes re-read User.role per request (DEC-065). requireAdmin
   exists; GET/PATCH /api/admin/orders exist. Product admin routes do not.
```

### 2 — Then, in the user's fixed order
```
M-009 remainder  profile screen · MULTIPLE addresses (REQ-F-051) —
                 note: GET /api/account/profile exists (F2b), no page;
                 the club page (/account/club) is a natural neighbour
M-011            the AI agent — 🔴 MockProvider ONLY, never touch a key
                 (DEC-014); the user chooses the provider; build so
                 deploying stays a config exercise
DEPLOY LAST      technical/DEPLOYMENT.md; CLIENT_ORIGIN + the in-memory
                 limiter store are the recorded traps
```

### Smaller owed items (fold into natural moments, don't block the queue)
```
· Field grows `multiline` and absorbs ContactPage's MessageField
· DESIGN_SYSTEM.md mid-document contrast tables still cite DEC-035 values
· checkout.integration concurrent double-submit FLAKED once (2026-08-15),
  green since — watch
· four OLDER drifted link-button cousins (NotFoundPage, CartPage,
  CartDrawer, AccountMenu) could adopt ui/LinkButton
· ISSUE-051's data half: 21/49 products still goalless (health_goals)
```

---

## The user's own queue (no agent can do these)

```
🔴 THE SIGNED-IN BROWSER PASS — now ALSO covers: /account/club end to end
   (menu → מועדון החברות → join → cart prices drop 10% + member note →
   leave → restore) · the dietary filters over the full flagged catalogue
   (kosher 43 · gluten-free 13 · vegan 13) · Latin brand names on every
   surface · the fallback suppression (brand+vegan empty state) ·
   /favourites · /checkout · /admin/orders · /account/orders.
   This pass CLOSES M-008 and M-012.
🔴 ISSUE-018's remainder: SVG logo + the Hebrew-wordmark decision.
🔴 ISSUE-020 — the real-device pass.
🔴 127a's LAST open sliver: whether Hebrew-UI product CARDS were the
   right place for Latin brands is settled (DEC-085 says yes, done);
   nothing remains unless the user changes course.
```

---

## What this session did (detail: SESSION_LOG passes 67–77)

```
03fb958  DEC-083 (user-approved): Product.isKosher/isGlutenFree/isVegan
         Boolean?, null = UNKNOWN. CSV tri-state columns · seed
         convergence + test · DEC-078's three filters LIVE (facet-gated,
         §9d/ISSUE-051) · ISSUE-129 brandNameEn through cart/checkout.
cd6499e  Enrichment batch 2 (20/49). ⚠️ "Fenupure" collision — see rules.
ab949f8  Batch 3 — ALL 30 Altman rows enriched.
80383c1  Batch 4 — the 19-row multi-brand tail; WAVE COMPLETE 49/49.
         Supherb's recorded 403 never appeared on the in-app-browser route.
98e1df0  The SIXTH list: ISSUE-135 brand facet labelEn · ISSUE-136/DEC-084
         (the "filter adds another company" report was §6b's fallback —
         filtering was CORRECT; the client now renders the fallback only
         when activeFilterCount === 0) · ISSUE-137 resolved by batch 4.
979f488  ISSUE-135 amended: the brand FILTER is Latin in BOTH languages.
b51dd88  DEC-085: brand Latin-first EVERYWHERE (cards/detail/home/cart);
         one pick, brandNameEn ?? brandName; ISSUE-127 closed in full.
ed809b3  M-012 A: club schema + lib/clubPricing.ts, THE one seam across
         cart/checkout/order; INV-02 freezes the DISCOUNTED price; the
         fingerprint ROUND-TRIP is the drift detector (one-sided discount
         → CHECKOUT_CHANGED, mutation-proven exactly so).
56e305c  M-012 B: GET/POST /api/account/club (idempotent; repeat join
         keeps the ORIGINAL date) + /account/club + menu link + `club`
         namespace (pin updated deliberately). Live-seam proof: joining
         changes the very next getCart read.
90515bc  M-012 C+D: clubMember on the cart DTO (strict validator) ·
         join-hint/member-note on cart+drawer · static detail hint.
         M-012 IS CODE-COMPLETE; the user's pass closes it.
(77th)   Memory hygiene: CURRENT_TASK 414→115 · STATUS 1375→417 (the
         2026-08-04 "next task" fossil removed) · ISSUES 2458→~480
         (43 resolved blocks archived verbatim). Every removed hash was
         verified at a destination FIRST — 50 in STATUS (zero orphans),
         and `efa8768` was found ONLY in CURRENT_TASK and carried into
         MILESTONE_PLANS §8.5 before deletion.
(78th)   ROADMAP.md reconciled on the user's follow-up — its leading
         sections had frozen at 2026-08-13 (backlog "next", admin gap
         "nothing reads role", "0 of 42"). Rebuilt to current truth;
         Phase records (CATALOGUE FACTS etc.) intact. ROADMAP · STATUS ·
         CURRENT_TASK · ISSUES · LOCK are ALL current as of this handoff.
```

---

## 🔴 Rules that BIT this session — read before writing code

The standing set (browser-verify with a CONTROL · mutation-prove AND
verify the mutation applied · never pipe before reading status · vitest
does not typecheck · lock before write · locale files via Edit only ·
`Accepted` only from the user) all held. New scar tissue:

```
🔴 A MUTATION THAT NEVER APPLIED READS AS A GREEN TEST. `tsx -e` with
   top-level await fails as CJS — the "mutation" run printed nothing,
   nothing was mutated, and the test stayed green. VERIFY THE MUTATION
   TOOK (read the row back / grep the file) before trusting any red-or-
   green. Script files beat -e one-liners; scripts importing app modules
   must live INSIDE the package (server/.tmp-*.mts) for module resolution.
🔴 "Fenupure" IS RESERVED. The ingredient-join search test uses it as the
   join-ONLY oracle and asserts no text field carries it (viaText===0).
   Batch 2's description draft tripped it — REWORD THE DATA, never the
   test. Generally: grep test files for a trade name before writing it
   into product text.
🔴 ENRICHED DATA BREAKS DATA-PINNED TESTS HONESTLY. "החרדית" became
   non-unique when kosher-cert text entered descriptions; the fix is the
   English sibling's pattern — derive the expectation from the searched
   field and ASSERT the premise (term absent from names), never re-pin.
🔴 STRICT DTO VALIDATORS RIPPLE INTO EVERY FIXTURE. Adding a required
   field (brandNameEn, clubMember) turned ~10 fixture files red across
   two rounds each time. Budget for it; tsc finds typed builders, but
   UNTYPED wire-shaped literals (useAddToCart cartBody, checkoutPay)
   only fail at RUNTIME — run the suites, don't trust tsc alone.
🔴 StrictMode DOUBLE-MOUNT CONSUMES mockResolvedValueOnce SEQUENCES —
   the second mount's effect aborts the first and ITS answer is the
   visible one. Seed one response per mount (ClubPage retry test).
🔴 CSV WRITES GO THROUGH A ROUND-TRIP-PROVEN SERIALIZER: parse with the
   project's own parseCsv, prove serialize(parse(file)) is byte-identical
   BEFORE editing, write only then (three batches, zero churn). Quote-
   aware record walking for column adds; records span lines.
🔴 THE EMPTY CART REPORTS clubMember=false EVEN FOR A MEMBER (shared
   EMPTY_CART constant) — render club hints only beside items. If a
   member-facing empty state is ever needed, that constant is the trap.
🔴 GIT-BASH MANGLES HEBREW IN PIPES/ARGS (surrogate errors, ���):
   python -c with Hebrew string literals needs a script FILE; grep of
   Hebrew through $(...) capture corrupts. Playwright getByRole with
   Hebrew names works; bash regex args to playwright find do not
   (MSYS path-mangling eats slashes).
🔴 A HYGIENE SWEEP'S OWN AUDIT CAN LIE: the first hash-audit loop
   reported "2 destinations" for hashes that had ZERO in the named files
   (unquoted Hebrew path glob). Re-audited per-file with quoted paths.
   Same family as the all-pass/all-reject screens — control-test the
   auditor before believing it.
```

---

## Measured at handoff

```
server 886 · client 975 · tsc 0 both · builds 0 · HEAD 90515bc · tree
clean · lock free · dev servers RUNNING on :3000/:5173 (left up; kill by
EXACT PID only — ISSUE-023) · dev DB seeded: 49 products flagged
(kosher 43 · gluten-free 13 · vegan 13), club columns live, both new
migrations applied · matrix run on every changed surface, he+en,
overflow control-tested · guest club/cart/filter flows live-verified;
the signed-in halves await the user
```
