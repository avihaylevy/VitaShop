# SESSION HANDOFF — M-011 SHIPPED · GROQ LIVE · DEPLOY IS WHAT REMAINS

> Rewritten 2026-08-19, closing the session that BUILT ALL OF M-011
> (checkpoints A-D, DEC-091) and then CONNECTED THE REAL PROVIDER
> (DEC-094, Groq) — passes 90-94. Every checkpoint was reviewed by
> finder angles before its commit; every review's findings were fixed
> before committing.
>
> ⚠️ **The memory system is authoritative** — everything here is also in
> `operations/` and `technical/`. This file is orientation, not state.

---

## 🔴 THE USER DECIDES. NOT THE AGENT. NO EXCEPTIONS.

```
🔴 THE SERVER/HOSTING · ANY API KEY · ANY PAID SERVICE · ANY NEW
   DEPENDENCY · ANY SCHEMA OR ARCHITECTURE CHANGE · anything absent
   from the spec and from DECISIONS.md
❌ silence is not acceptance · a general "go ahead" is not acceptance
   of a SPECIFIC host/key/dependency · never obtain or configure a key
✅ present options WITH a recommendation, wait, record the answer as a DEC
```

The AI provider question is now SETTLED (DEC-094: Groq, the user's own
pick, key placed by the user personally). 🔴 The key rules still bind:
never read server/.env, never echo anything key-shaped, and any switch
to a DIFFERENT provider/model tier is a new stop-and-ask.

---

## Orientation

```
Repository:     C:\Users\aviha\תכנות\VitaShop
Memory system:  C:\Users\aviha\תכנות\זיכרון AI\פרוייקט ECOMMERCE\
                פרוייקט Ecommerce\VitaShop-Project
HEAD:           see git log — this session's commits, newest last:
                211ca4f  M-011 A — POST /api/ai/chat vs MockProvider
                5fe18c3  M-011 B — the chat surface
                b7d7846  M-011 C — the REQ-F-077 handoff
                5974004  M-011 D — the acceptance sweep
                (+ the DEC-094 Groq commit closing this session)
Suites:         server 1067 · client 1030 · tsc 0 both · builds 0
Decisions new:  DEC-094 ACCEPTED+BUILT (Groq via plain fetch, NO SDK,
                openai/gpt-oss-120b via GROQ_MODEL || default —
                llama-3.3-70b was deprecated by Groq 6/2026 · key is
                the user's, in server/.env · loud mock fallback ·
                keyword redaction at the provider boundary)
Dependencies:   NONE added the whole session (Groq is plain fetch).
Running:        dev servers DOWN. localhost daily default; LAN-IP
                recipe for a device pass is in SESSION_LOG pass 82.
```

Read in order: `CLAUDE.md` → `00_INDEX.md` → `operations/LOCK.md` →
`operations/STATUS.md` → `operations/CURRENT_TASK.md` →
`.claude/rules/browser-verification.md`.

---

## What works NOW (tested, not just written)

The AI agent end to end, twice over:
- **MockProvider** (default everywhere, incl. every test): floating
  button on every page → panel → three stages → products from
  PostgreSQL only → fixed byte-pinned disclaimer → REQ-F-077 handoff
  landing on /catalog with the filters CHECKED. Zero DB writes,
  row-count-proven. 20/15min IP limiter.
- **GroqProvider** (AI_PROVIDER=groq in the user's .env): same
  pipeline, real 120B model, live filter schema in the prompt (60s
  cache) — "training" is a per-request cheat-sheet, never a training
  run. Known-sensitive keywords (medications · pregnancy · named
  diagnoses) are REDACTED before any text leaves the process —
  honest scope: a keyword screen, not NER (documented in triggers.ts).
  ONE real smoke call verified extraction + redaction live (1.2s).

🔴 Tests can never touch the real API: `src/vitest.setup.ts` pins
AI_PROVIDER=mock globally (it DID hit the real API once before the pin
— the scar is documented there).

---

## 🔴 THE NEXT SESSION'S ORDERED QUEUE

### 1 — DEPLOY (the last milestone; plan first → the user → build)
```
technical/DEPLOYMENT.md. The recorded traps:
· CLIENT_ORIGIN (CORS — exact origin, never *)
· the in-memory rate-limiter store (multi-instance needs a shared
  store or the ceilings silently multiply)
· §8b UPLOADS_DIR (cwd-anchored; PaaS filesystems are EPHEMERAL)
· NEW: GROQ_API_KEY + AI_PROVIDER + GROQ_MODEL must reach the host's
  env — the user sets them there PERSONALLY; missing key = loud mock
  fallback by design, and the shape guard refuses non-ASCII keys
· trust proxy (index.ts's comment) becomes LOAD-BEARING behind a proxy
```

### Smaller owed items (fold into natural moments, don't block)
```
· groq redaction: NER-grade masking is a recorded hardening item
  (keyword screen today; scope comment in triggers.ts)
· the description-injection probe against the REAL prompt if Stage 3
  ever gains product descriptions (structurally closed today — the
  list DTO carries none; noted in aiChat.integration.test.ts)
· withTimeout unification with checkout's inline copy (recorded-skipped
  at the B review)
· CartDrawer's always-mounted body cost ×4 mounts (recorded-skipped)
· LinkButton adoption by CartDrawer's two hand-styled links (the new
  onClick prop unblocked them — C review note)
· health-goal editing on PATCH (DEC-092 create-only) · category
  <option> labels nameHe in English UI · Field multiline ·
  DESIGN_SYSTEM DEC-035 tables · ISSUE-051 data half (21/49 seeded
  goalless) · admin failure-message mapping ×3 · GET /profile
  defaultAddress LEGACY
```

---

## The user's own queue (no agent can do these)

```
🔴 THE SIGNED-IN BROWSER PASS — now ALSO covers, on top of the
   standing list: THE AGENT PANEL against the REAL Groq provider
   (Hebrew + English conversations · the notice on a trigger · an
   empty result's handoff into /catalog · add-to-cart from a card ·
   the turn limit) — with AI_PROVIDER=groq in server/.env.
   Seeded accounts: npm run seed:accounts → admin@/shopper@vitashop.local.
🔴 DEPLOY DECISIONS — host/platform choice is the user's; the agent
   presents options with a recommendation first.
🔴 ISSUE-018's remainder: SVG logo + the Hebrew-wordmark decision.
🔴 ISSUE-020 — the real-device pass (LAN-IP recipe, pass 82).
```

---

## What this session did (detail: SESSION_LOG passes 90-94)

```
(90th)  Jotform evaluated and REJECTED for M-011 (closed SaaS widget
        breaks the three-stage architecture + §3.3). Groq recommended
        over local Ollama (70B Hebrew ≫ 8B). The user's GO → A BUILT.
211ca4f (91st) A reviewed (8 angles, 10 findings fixed — curly-
        apostrophe medical-stop bypass · sibling-name guard blanking ·
        orphan-taxonomy English path · handoff-400 round trip) →
        committed. B BUILT (chat surface).
5fe18c3 (92nd) B reviewed (10 findings — unmount-takes-focus ×3 ·
        nested modals → one-at-a-time + FAB focus return · silent
        quiet adds · failed sends eating turns · widget-owned live
        region) → committed. C BUILT (handoff).
b7d7846 (93rd) C reviewed (10 findings — modified-click close ·
        pageRaw allowlist · empty-handoff link · role=log double-read
        · missing agent i18n suite · router-not-asserted tests) →
        committed. D DONE: TEST-070..077 sweep + full matrix +
        traceability REQ-F-070..077 → Implemented.
5974004 D's tests reviewed (6 findings — the vacuous injection test
        chief among them) → committed. M-011 CODE-COMPLETE.
(94th)  DEC-094: user picked Groq, confirmed the package, placed the
        key. Built groqProvider.ts (plain fetch, no SDK) + redaction +
        loud fallback + 27 provider/redaction tests. Review (3
        angles): 10 findings fixed — the Headers-TypeError KEY LEAK
        path (shape guard) · the GROQ_MODEL='' trap · unguarded
        JSON.parse leaking model text · redaction over-claim/over-mask
        (vocabulary split from detection, ASCII mask, longest-first) ·
        global test pin · stale privacy headers. Smoke call verified.
```

---

## 🔴 Rules that BIT this session — read before writing code

```
🔴 THE VACUOUS-CHECK FAMILY STRUCK AGAIN (instances 10-12):
   · the D injection test matched no keyword, took the clarify branch,
     and its explanation loop ran ZERO times — a security test that
     never reached the stage under test, with a comment claiming
     otherwise. Counter-move unchanged: trace the fixture through the
     REAL pipeline and make the test's branch the one you claim.
   · the redaction tests were all not.toContain — a mask of '' passed
     every one. Pin the FULL OUTPUT STRING, not the absence.
   · the byte-pin that imports the constant it pins is vacuous; type
     the literal (A review) — and a round-trip test whose two halves
     share a file lets a symmetric mutation cancel out (C review).
🔴 A DEV .env IS AN INPUT TO THE TEST SUITE: importing ../index.js
   resolves the provider AT IMPORT TIME. The suite hit the real Groq
   API and spent quota the day the key landed. Pin overriding env in a
   SHARED setupFiles, not in one file's beforeAll.
🔴 ERROR MESSAGES ARE AN EXFILTRATION PATH: Node's Headers TypeError
   embeds the header VALUE (the key!); V8's SyntaxError embeds the
   parsed snippet (model output). Guard at the boundary with FIXED
   error messages; never console.error an error whose message you do
   not control.
🔴 `?? DEFAULT` DOES NOT SAVE YOU FROM '' — .env.example ships empty
   values and dotenv reads them as empty STRINGS. Normalize with
   `?.trim() || DEFAULT` at the consumer.
🔴 REDACTION VOCABULARY ≠ DETECTION VOCABULARY: masking every trigger
   keyword turned "thyroid support" into a dead-end clarify loop for
   exactly the users who tripped a trigger. Detection may be broad;
   masking must be specific.
🔴 THE UNMOUNT-TAKES-FOCUS FAMILY: three MORE instances in one diff
   (B review). Before shipping ANY control: after this succeeds, does
   the thing I just pressed still exist?
🔴 CLIENT SUITE UNDER PARALLEL LOAD (ISSUE-096): 3 timeout reds on
   unrelated pages, green isolated, green on the full re-run. Re-run
   before believing a red.
```

---

## Measured at handoff

```
server 1067 · client 1030 · tsc 0 both · builds 0 · tree clean after
the DEC-094 commit · lock free · dev servers DOWN · M-011 SHIPPED with
Groq live · deploy is the last milestone · the signed-in pass (now
incl. the real-provider agent conversation) is the user's
```
