# SESSION HANDOFF — M-011 build awaits the user's GO

> Rewritten 2026-08-17, closing the session that PLANNED M-011 (DEC-091),
> fixed three admin-create user reports (new company · dietary claims +
> health goals · duplicate detection — DEC-092, DEC-093), and shipped two
> commits (`7f42e93`, `d55fd53`), passes 84–89.
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

⚠️ The standing pattern held again: plan as a MILESTONE_PLANS section
(Proposed) → AskUserQuestion in ONE batch → every answer a DEC → build →
review (finder angles, inline) → fix everything → the user's commit word.
DEC-091/092/093 all went exactly this way.

---

## Orientation

```
Repository:     C:\Users\aviha\תכנות\VitaShop
Memory system:  C:\Users\aviha\תכנות\זיכרון AI\פרוייקט ECOMMERCE\
                פרוייקט Ecommerce\VitaShop-Project
HEAD:           d55fd53 — DEC-093 duplicate detection. Before it:
                7f42e93 (new-company create + DEC-092 dietary/goals) ·
                62a88fc (M-009).
Tree:           CLEAN · lock 🔓 FREE (eighty-ninth pass released)
Suites:         server 950 · client 1001 · tsc 0 both · builds 0
Decisions new:  DEC-091 (M-011 answers: NO conversation storage —
                ISSUE-012 closed · floating button+panel · strict rate
                limits · all eight triggers · provider DEFERRED,
                skeleton neutral; §11.7 records a Haiku 4.5
                recommendation, NOT decided) · DEC-092 (admin writes
                tri-state dietary claims + health goals incl. inline
                new bilingual goals — amends DEC-083) · DEC-093
                (normalized duplicate detection + allowDuplicate
                override; trigram/barcodes REJECTED as overengineering)
Dependencies:   none added this session.
Running:        dev servers DOWN (killed by exact PID). localhost is
                the daily default in both env files; for a device pass:
                ipconfig → Wi-Fi IPv4 → client/.env VITE_API_BASE_URL +
                server/.env CLIENT_ORIGIN → restart both.
```

Read in order: `CLAUDE.md` → `00_INDEX.md` → `operations/LOCK.md` →
`operations/STATUS.md` → `operations/CURRENT_TASK.md` →
`.claude/rules/browser-verification.md`.

---

## 🔴 THE NEXT SESSION'S ORDERED QUEUE

### 1 — M-011 THE AI AGENT (planned; 🔴 BUILD NOT AUTHORIZED)
```
The plan is DONE and Accepted: technical/MILESTONE_PLANS.md §11
(DEC-091). Checkpoints §11.8: A lib/ai + POST /api/ai/chat + server
tests → B chat surface → C REQ-F-077 handoff → D safety sweep + matrix.
🔴 The user explicitly instructed PLAN-ONLY; Checkpoint A starts on
their explicit go and nothing else. MockProvider ONLY (DEC-014): never
obtain/generate/configure a key; provider-neutral skeleton (DEC-091 O5
deferred the vendor). §11.5 lists the six-step real-provider gate.
```

### 2 — DEPLOY LAST
```
technical/DEPLOYMENT.md. The recorded traps: CLIENT_ORIGIN (CORS) ·
the in-memory rate-limiter store · §8b UPLOADS_DIR (cwd-anchored;
PaaS filesystems are EPHEMERAL — uploads vanishing on redeploy is a
decision to take).
```

### Smaller owed items (fold into natural moments, don't block the queue)
```
· server-side twin-id binding for allowDuplicate (recorded-skipped
  review finding: the override is a global boolean; bind it to the
  twin's id if a second admin surface ever appears)
· health-goal editing on PATCH (DEC-092 item 3 — create-only today)
· category <option> labels render nameHe even in the English UI
  (pre-existing, noted pass 88)
· Field grows `multiline` and absorbs ContactPage's MessageField
· DESIGN_SYSTEM.md mid-document contrast tables still cite DEC-035
· four older link-button cousins could adopt ui/LinkButton
· ISSUE-051's data half: 21/49 SEEDED products still goalless (the
  admin path now feeds goals for NEW products only)
· admin failure-message mapping ×3 · GET /profile defaultAddress is
  LEGACY (retiring it is its own decision)
```

---

## The user's own queue (no agent can do these)

```
🔴 THE SIGNED-IN BROWSER PASS — now ALSO covers, on top of the standing
   list: the admin create form's NEW COMPANY flow (+ Latin form) ·
   dietary tri-state selects · health-goal checkboxes + inline new-goal
   rows · the duplicate refusal + "create anyway" override ·
   /account/profile + address book · checkout picker · /admin/products
   incl. image URL/upload · the header cart card · club/dietary/brands/
   favourites/checkout/orders.
   Seeded accounts: npm run seed:accounts → admin@/shopper@vitashop.local.
🔴 M-011 BUILD AUTHORIZATION — say "go" (or not) for Checkpoint A.
🔴 ISSUE-018's remainder: SVG logo + the Hebrew-wordmark decision.
🔴 ISSUE-020 — the real-device pass (LAN-IP recipe above).
```

---

## What this session did (detail: SESSION_LOG passes 84–89)

```
(84th)   M-011 PLANNED: §11 written (AI_AGENT_SPEC's three stages ·
         MockProvider-only · spec limits 5/10/15s adopted) →
         AskUserQuestion → DEC-091. ISSUE-012 closed by decision.
         Provider DEFERRED (Haiku 4.5 recommendation recorded in §11.7
         for the day the user decides). NO CODE — plan-only by
         instruction.
7f42e93  (85th-87th) THREE USER-REPORT FIXES in one commit: create
         with a NEW company (brandId XOR newBrandName, insensitive
         dedupe over BOTH stored forms incl. the typed Latin form,
         NESTED create = no orphan) · DEC-092 dietary tri-state on
         create+PATCH + goal picker with inline new bilingual goals
         (shop filters live-proven, vegan negative control) · 5-finding
         review all fixed (Enter-in-draft submitted the form · Latin
         dedupe · batched goal dedupe · stale comment · connect test).
d55fd53  (88th-89th) DEC-093 duplicate detection: normalizeProductName
         (ONE pure function; digits NEVER stripped — counts keep
         variants distinct) · brand-scoped create+rename gates ·
         PRODUCT_DUPLICATE names the twin · allowDuplicate override,
         consent WITHDRAWN on name/brand edits (review finding) ·
         PATCH checks only the names it SETS. Controls: cross-brand
         same-name and different-count variants create freely.
```

---

## 🔴 Rules that BIT this session — read before writing code

The standing set all held. New scar tissue:

```
🔴 THE VACUOUS-CHECK FAMILY STRUCK TWICE MORE (instances 8 and 9):
   · the no-orphan tests refused via a bad categoryId — which returns
     BEFORE the brand/goal code, so an eager-create mutation sailed
     GREEN. Rewritten to fail AT the insert (slug-suffix exhaustion by
     50 pre-seeded squatters).
   · the normalized-variants test changed ONE name per variant — the
     untouched OTHER name still matched, and the quote-strip mutation
     sailed GREEN. Each variant now isolates a single name path.
   The counter-move is unchanged and non-negotiable: BREAK IT ON
   PURPOSE AND CONFIRM RED, and make sure the red comes from the RULE
   under test, not a sibling guard.
🔴 NEVER git checkout TO REVERT A MUTATION ON UNCOMMITTED WORK — it
   wiped the file's uncommitted feature edits mid-verification once
   (85th pass). Revert mutations BY EDIT.
🔴 A FIXTURE SWEEP MUST MATCH EVERY CASING ITS TESTS CREATE — a
   case-sensitive startsWith cleanup left a mutation run's UPPERCASE
   brand row alive, and it poisoned three later dedupe tests.
🔴 AN OVERRIDE CONSENTS TO ONE SPECIFIC THING — a ticked
   "create anyway" surviving a name edit would have silently overridden
   a DIFFERENT twin. Consent resets when what-it-consents-to changes.
🔴 CLIENT SUITE UNDER PARALLEL LOAD: 14 timeout failures across
   unrelated pages while the server suite ran beside it — the
   ISSUE-096 flake family. Re-run isolated before believing a red.
```

---

## Measured at handoff

```
server 950 · client 1001 · tsc 0 both · builds 0 · HEAD d55fd53 · tree
clean · lock free · dev servers DOWN · every feature milestone
code-complete · M-011 planned (DEC-091), build gated on the user's go ·
the signed-in passes are the user's
```
