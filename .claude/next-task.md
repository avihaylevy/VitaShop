# SESSION HANDOFF — EVERYTHING PRE-DEPLOY IS DONE · DEPLOY IS ON HOLD FOR THE LECTURER · THE SUBMISSION DOCUMENT EXISTS

> Rewritten 2026-08-22, closing the session that ran passes 110–119:
> the analytics milestone (DEC-101/102), the ISSUE-189 visitor-identity
> fix (DEC-103), the decisions batch (DEC-095/100 Accepted), the
> TextLink and LinkButton primitives, the dashboard per-range cache,
> the agent's top pick (DEC-104), the Hebrew submission document, and
> four full review-fix-commit cycles. SESSION_LOG passes 110–119.
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
🔴 Commit-gating by default: build and verify, then WAIT for the user's
   commit word — unless their instruction for the task already said
   "then commit" (this session's pattern).
🔴 Never read server/.env. Tests pin AI_PROVIDER=mock (vitest.setup) —
   the user's dev server may run the REAL Groq provider; NEVER send it
   chat messages from browser verification. To verify the agent live,
   start your OWN server with AI_PROVIDER=mock forced in the process
   env (precedent: pass 118).
```

---

## Orientation

```
Repository:     C:\Users\aviha\תכנות\VitaShop
Memory system:  C:\Users\aviha\תכנות\זיכרון AI\פרוייקט ECOMMERCE\
                פרוייקט Ecommerce\VitaShop-Project
HEAD:           c878c7b (hundred-nineteenth pass) — tree CLEAN.
Suites:         server 1132/1132 · client 1037/1037 · tsc/builds 0.
Running:        the user usually keeps the CLIENT dev server up (:5173).
                Start the API server yourself when needed; stop it by
                exact PID; port 3000 was left free.
```

Read in order: `CLAUDE.md` → memory `00_INDEX.md` → `operations/LOCK.md`
→ `operations/STATUS.md` → `operations/CURRENT_TASK.md` →
`.claude/rules/browser-verification.md`.

---

## What this session shipped (all committed, all reviewed)

- **The analytics milestone** (DEC-101/102, `0598572`): §4.7.5 funnel
  events at four seams · §4.7.4 `/admin/dashboard` + GET
  /api/admin/dashboard (7/30/90 UTC-calendar days) · §1.6's four KPIs ·
  §4.7.2 per-product low-stock threshold + panel. NO migration — the
  schema pieces existed since DEC-024.
- **DEC-103** (`01d91c7`): the funnel keys on a durable `vs_vid` visitor
  cookie (survives login regeneration and anonymous non-persistence).
  ISSUE-189's identity half closed.
- **The decisions batch** (`bea8662`): DEC-095 + DEC-100 Accepted ·
  ISSUE-188 option A · funnel_events indexes REDESIGNED to two
  superseding secondaries (the original `(event_type, created_at)` was
  dropped as a strict prefix) · ui/Textarea · Field as a discriminated
  union · LinkButton rest-spread/min-h/ghost/block · modified-click
  close-declines everywhere.
- **ui/TextLink** (`1b9901d`): ~30 hand-rolled quiet links across 19
  files became one primitive — and 11 auth links had referenced the
  NONEXISTENT `text-brand-primary` token (colourless until now).
- **The dashboard per-range cache** (`b43fdcc` + hardening in
  `c878c7b`): instant toggles, ONE sequence-number staleness guard for
  every load entry point, range-scoped failures, a retry on the
  refresh-failed notice.
- **The agent's top pick** (DEC-104, `ed1b511` + hardening in
  `c878c7b`): Stage 3 returns explanations + a ranked pick INTO the
  retrieved list; the route validates AND drops a pick whose
  explanation the guard blanked (an injected turn cannot reorder
  merchandising); pinned first; ui/Badge `agent` variant. Groq's
  schema is genuinely lenient (`z.unknown()`); "topPick": 0 logs as
  the off-by-one it is. ISSUE-161 closed.
- **The Hebrew submission document** (pass 113, NOT in the repo):
  `מסמך הגשה סופי - VitaShop.docx` in the course OneDrive folder,
  5-section lecturer template, 13 pages, built on the PRD, updated to
  the implementation, 5 diagrams + 6 live screenshots + the recorded
  deviations table. The user will want refinements when the project
  finishes (their words) — section 4 carries a placeholder for the
  live link.

---

## 🔴 THE NEXT SESSION'S ORDERED QUEUE

### 1 — DEPLOY (the last milestone) — ⏸ ON HOLD
The user awaits LECTURER CLARIFICATIONS before deciding. Four decisions
were presented with recommendations and are QUEUED, not answered:
```
· Host: Render (server web service + client static) + Neon Postgres
  (free DB that does not expire) — RECOMMENDED; alternatives all-in
  Render (free DB expires in 30 days) / Railway / no public deploy.
· Tier: free with ~1min cold start after 15min idle — RECOMMENDED —
  vs ~$7/mo always-on.
· AI on host: AI_PROVIDER=mock — RECOMMENDED (user can flip to groq
  by setting the env trio themselves) — vs groq from day one.
· Uploads: accept the ephemeral filesystem (re-upload after deploys,
  prefer external URLs) — RECOMMENDED — vs disabling uploads in prod.
```
Execution notes when it resumes: technical/DEPLOYMENT.md is the
contract. Traps recorded there: exact CLIENT_ORIGIN (never *) ·
`trust proxy` to the REAL depth (cookie + IP limiter both depend on
it) · in-memory limiter store (multi-instance multiplies ceilings) ·
§8b UPLOADS_DIR cwd anchor · TWO pg pools ≈20 connections vs free-tier
caps · the Groq env trio is set by the USER personally · the funnel
index migration wants CONCURRENTLY on a populated table (note inside
the migration file). The USER creates the hosting accounts (never the
agent). After deploy: the live link goes into section 4 of the
submission document + README.

### 2 — Post-deploy items already recorded
```
· ISSUE-190 — product-scoped explanation-guard screening (substring-
  named products are unscreenable today; the rank-follows-prose gate
  shipped as mitigation).
· ISSUE-189's tail — buffered funnel inserts.
· Deferred BY THE USER to after deployment: ISSUE-160 hard delete ·
  ISSUE-163 Google OAuth · the save-card option (DEC-098).
· The submission document's final refinements + live link.
```

### The user's own queue (no agent can do these)
```
🔴 LECTURER CLARIFICATIONS → the four deploy answers above.
🔴 THE SIGNED-IN BROWSER PASS — formally closes M-008/009/010/011/012;
   now ALSO covers /admin/dashboard (KPIs, funnel, low-stock panel,
   range toggles) and the agent's top-pick badge against real Groq.
   Seeded accounts: npm run seed:accounts.
🔴 Read the submission document (course OneDrive folder).
🔴 ISSUE-018 (SVG logo + Hebrew wordmark) · ISSUE-020 (real-device pass).
```

---

## 🔴 Rules that BIT this session — read before writing code

```
🔴 A "lenient" zod field inside a safeParse'd OBJECT is not lenient:
   z.number().optional() on topPick failed the WHOLE parse for
   "topPick": null and destroyed the good explanations beside it.
   Leniency means z.unknown() + validation at the consumer.
🔴 HALF-TRUSTING A REJECTED PAYLOAD: when the guard blanks a provider's
   prose, every OTHER field derived from that same turn (the rank) must
   fall with it — or an injected turn steers through the surviving half.
🔴 ONE STALENESS MECHANISM PER RESOURCE, covering EVERY entry point:
   the effect-scoped closure guard missed the retry button; a
   sequence-number ref covers both. And per-key resources need
   per-key failure state — a global failure slot misattributes.
🔴 findFirst WITHOUT orderBy is a live-data flake: Postgres row order
   drifts after inserts. Fixture selection always orders.
🔴 A required field added to a client response validator breaks
   client-ahead-of-server deploys — tolerate absence, normalise.
🔴 The graphify hook demands `graphify query` before grep/read —
   run one query per work area first; include the rule in subagent
   prompts. Run `graphify update .` after code changes.
🔴 Multi-cookie Set-Cookie: headers.get('set-cookie') is a JOINED
   string; use headers.getSetCookie() and a real jar (two cart suites
   broke when the visitor cookie became the second cookie).
🔴 The PIPE TRAP stands: run compilers bare or capture to a file and
   read $? — never `cmd | head; echo $?`.
```

---

## Measured at handoff

```
HEAD c878c7b · tree CLEAN · server 1132/1132 · client 1037/1037 ·
tsc 0 both · builds 0 both · lock FREE · ports 3000 free, 5173 the
user's · dev DB has ISSUE-188-class funnel residue (accepted, option A)
· DEPLOY is the only milestone left and it waits on the user.
```
