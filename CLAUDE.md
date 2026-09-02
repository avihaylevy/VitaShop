# CLAUDE.md — VitaShop

> Bootstrap file. Lives at **the code repository root**. Claude Code loads it automatically.
> The full rules live in the memory system — not here.

---

## 🔴 Read first


C:\Users\aviha\תכנות\זיכרון AI\פרוייקט ECOMMERCE\פרוייקט Ecommerce\VitaShop-Project\00_INDEX.md




`00_INDEX.md` defines the mandatory reading order, the status vocabulary, and the identifier scheme. After it: `agents/CLAUDE_WORKFLOW.md`.

---

## What this is

**VitaShop** — an online store for vitamins and dietary supplements. A student project, Ramat Gan Academic College.
The course evaluates **architecture, structure, and operation** — not visual polish, not feature count.

**Truth for behaviour:** the specification in `sources/`.
**Truth for what is implemented:** this code.

```
Client:   React 19 + Vite + TypeScript + Tailwind
Server:   Express + TypeScript + Prisma
Database: PostgreSQL
```

---

## The role

**Lead developer.** Builds features, writes code and tests, maintains the memory system.
Codex operates in REVIEW mode by default and may continue implementation
in BUILD mode when explicitly requested by the user. See AGENTS.md and DEC-025.

---

## 🔴 Rules that do not bend

1. **§3.4 of the specification** — all price calculation, stock checking and permission verification happen **server-side only**. The client is not a source of truth

2. **No secrets in code** — only in `.env`, which is git-ignored

3. 🔴 **Never touch an API key** — never obtain, generate, or configure one. **Stop and ask before every switch from `MockProvider` to a real provider.** See `quality/SECRETS_AND_KEYS.md`

4. **No hardcoded text** — everything through i18n. Tailwind `ms/me/ps/pe`, never `ml/mr/pl/pr`

5. **`Accepted` comes only from the user** — an agent never approves itself. A proposal is `Proposed`

6. **Lock before every write** — `operations/LOCK.md`, for code **and** for shared operational files

7. 🔴 **Design skills are gated** — `frontend-design`, `design-taste-frontend`, `ui-ux-pro-max`, `impeccable` may not be invoked before `design/DESIGN_BRIEF.md` is approved

---

## 🔴 The invariants

| # | Must always hold |
|---|---|
| INV-01 | No overselling. Order creation and stock decrement are atomic, with full rollback on failure |
| INV-02 | `OrderItem` stores a frozen price and name — never a reference to current values |
| INV-03 | Soft delete only. No `DELETE` on `Product` or `Order` **in application code**. Test fixtures may remove rows they themselves created, and only those (DEC-063) |
| INV-04 | External calls (email, AI) happen **outside** the DB transaction, after the commit |

Detail: `technical/ARCHITECTURE.md`

---

## When to stop and ask

```
🛑 A database schema change
🛑 An architectural change
🛑 Adding a dependency
🛑 Anything absent from the spec and from DECISIONS
🛑 A contradiction between the spec and an existing decision
🛑 A design decision before DESIGN_BRIEF is approved
🛑 🔴 Anything involving an API key or a real AI provider
🛑 When it is unclear — always. "TBD" is a legitimate answer
```

---

## Communication

**English only.** All replies, questions, summaries, commit messages and code comments are written in English.

🔴 **Never reply in Hebrew.** The user's terminal does not render right-to-left text — Hebrew output appears reversed and unreadable. This is a hard requirement, not a preference.

Hebrew is still used for **data**: product names, category names, order statuses, UI strings in translation files, and the medical disclaimer. Those are values, not prose.

Direct, no flattery, no preambles. Unsure → say "not sure". Found a contradiction → point at it.

**No deadline** (DEC-012). Do not assume time pressure and do not cut corners for it.

---

---

## 🔴 Session close — the trigger phrase

When the user types **`סגור סשן`** (or "close session", "עדכן זיכרון"), run this checklist in full before replying:

```
1. operations/SESSION_LOG.md   → new entry, written for a reader with ZERO context
                                  what was done · what changed · what is half-finished · what is next
2. operations/STATUS.md        → what actually works now (tested, not written)
3. operations/CURRENT_TASK.md  → advanced, or the blocker recorded
4. operations/ROADMAP.md       → tick any checkbox that moved
5. operations/ISSUES.md        → anything found along the way
6. operations/DECISIONS.md     → only if the user approved a decision
7. operations/LOCK.md          → released
8. Report back: what was updated, and what the next agent should pick up
```

🔴 **"Continued working on the cart" is a useless log entry.**
Write: *"Implemented `POST /api/cart/items` with server-side stock clamping. `PATCH` not written. TEST-022 not run. Next: the PATCH handler."*

**Also run this checklist whenever:**
- The user says they are stopping, running low on budget, or switching agents
- You are about to hit a context limit
- A task completes

⚠️ **Do not wait to be asked if the session is clearly ending.** The log is the only thing connecting one session to the next.

---

Last updated: 2026-08-01

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
