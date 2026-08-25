# VitaShop

An e-commerce store for vitamins and dietary supplements, built as a coursework project for **Digital Systems Planning and Development**, Ramat Gan Academic College.

The course evaluates **architecture, structure, and system operation** — not visual polish or feature count. That shapes every decision in this repository.

---

## 🔴 Project memory

**Requirements, decisions, tasks and status do not live in this repository.** They live in a separate Markdown knowledge base:

```
C:\Users\aviha\תכנות\זיכרון AI\פרוייקט ECOMMERCE\פרוייקט Ecommerce\VitaShop-Project\00_INDEX.md
```

**Start there.** `00_INDEX.md` defines the mandatory reading order, the status vocabulary, and the identifier scheme.

| Looking for | File |
|---|---|
| What the system must do | `product/FUNCTIONAL_REQUIREMENTS.md` — 42 requirements |
| Why something was built a certain way | `operations/DECISIONS.md` |
| What actually works right now | `operations/STATUS.md` |
| What is being worked on | `operations/CURRENT_TASK.md` |
| Known problems and open questions | `operations/ISSUES.md` |
| Architecture and invariants | `technical/ARCHITECTURE.md` |
| 🔴 API keys and secrets | `quality/SECRETS_AND_KEYS.md` |

**Why it is external:** the knowledge base is an Obsidian vault the author maintains alongside the code. Keeping it out of the repository means requirements and decisions are versioned as prose rather than tangled with source history, and it stays usable when the repository is empty — as it is now.

---

## Status

**Planning. No application code yet.**

```
✅  Specification read and mapped — 42 requirements, 7 user flows, acceptance tests
✅  Stack decided
✅  Repository skeleton and agent instructions in place
✅  15 product images and the seed-data structure ready
⬜  Database schema — blocked on an open decision
⬜  Server, client — not started
```

**Four decisions block the first line of server code.** They are tracked as `ISSUE-011`, `ISSUE-007`, `ISSUE-006` and the schema approval that depends on them. See `operations/CURRENT_TASK.md`.

`operations/STATUS.md` is the authoritative, dated status. This section will drift; that file will not.

---

## Tech stack

```
Client    React 18 · Vite · TypeScript · Tailwind CSS · React Router
Server    Express · TypeScript · Prisma
Database  PostgreSQL
```

**Why client and server are separate projects rather than a unified framework:** the specification defines three layers communicating by request/response, with the server as the sole source of truth for prices, stock and permissions. Physical separation makes that property demonstrable rather than merely claimed, and keeps the API surface small enough to audit.

---

## Repository structure

```
VitaShop/
├── README.md              you are here
├── CLAUDE.md              instructions for Claude Code
├── AGENTS.md              instructions for Codex
├── CODEX.md               pointer to AGENTS.md
├── assets/
│   ├── brand/             logo, favicon — the logo is swappable via one constant
│   ├── products/          product images + seed data
│   │   ├── products.csv       one row per product
│   │   ├── ingredients.csv    one row per active ingredient
│   │   └── REFERENCE.md       allowed values and fill order
│   └── ui/                icons, backgrounds
├── client/                React frontend — not yet scaffolded
└── server/                Express backend — not yet scaffolded
```

### Product data

`assets/products/products.csv` is the single source of truth for the catalogue. The seed script reads it; nothing else defines what products exist.

🔴 **Two tiers of field, with different rules:**

| Tier | Fields | Rule |
|---|---|---|
| Invent freely | price · stock · description · health goals | A demo store. Accuracy is irrelevant |
| **Must be accurate** | active ingredients · warnings and allergens · usage instructions · package quantity | These describe **real products**. A wrong allergen is a safety problem, not a cosmetic one |

The catalogue uses photographs of real branded products for academic purposes. A made-up price reads as obviously fictional; a made-up allergen list does not. See `assets/products/REFERENCE.md`.

---

## Agent instructions

Three files at the repository root, loaded automatically by filename:

| File | Loaded by | Purpose |
|---|---|---|
| `CLAUDE.md` | Claude Code | Lead developer — builds features, writes code and tests |
| `AGENTS.md` | Codex | Reviewer and second developer |
| `CODEX.md` | nobody | A pointer, so the name is not searched for in vain |

**Codex runs in one of two modes, selected explicitly by the user:**

- **REVIEW** (default) — finds and fixes bugs and security problems. Adds nothing.
- **BUILD** (on request) — continues the work plan as lead developer, bound by the same rules as Claude.

The second mode exists so development can continue when one agent's budget runs out, without the knowledge base losing coherence.

---

## Specification

The functional specification (`מסמך אפיון ראשוני.docx`, Hebrew) is the source of truth for **what the system must do**. This repository is the source of truth for **what is actually implemented**. A disagreement between them is an implementation gap, not a contradiction.

The canonical copy is registered as `SRC-001` in the knowledge base:

```
VitaShop-Project/sources/
```

It is read-only. It is deliberately **not** duplicated here — one canonical copy cannot drift out of sync with itself.

⚠️ **Before submission**, copy it into `docs/` so the repository is self-contained for a reviewer who does not have the vault.

### What the specification leaves open

It states explicitly that it does not cover technology selection, screen design, or database structure at the table level. Those are decided in `operations/DECISIONS.md`, each with its reasoning.

---

## 🔴 Security

This project handles authentication, pricing and stock. A few rules are non-negotiable and are enforced in review:

- **All price calculation, stock checking and permission verification happen server-side.** The client is never a source of truth
- **No secrets in the repository.** API keys, database passwords and session secrets live only in `.env`, which is git-ignored
- **No agent obtains or configures an API key.** The AI provider defaults to a mock implementation; switching to a real provider requires an explicit human decision each time
- **Payment is simulated.** No card details are collected, transmitted or stored anywhere

Full detail: `quality/SECURITY_PRIVACY.md` and `quality/SECRETS_AND_KEYS.md` in the knowledge base.

⚠️ **A key committed to a remote repository is compromised on arrival** — automated scanners crawl public commits, and git history retains the value after the file is deleted. Revocation is the fix; rewriting history is not.

---

## Getting started

**The system is fully implemented and runs locally end to end.**
The complete walkthrough — PostgreSQL install options, environment files,
seeding, login accounts, tests — is in **[SETUP.md](SETUP.md)**.

The short version, from the repo root:

```bash
npm run setup        # install server + client dependencies
# create a local vitashop_dev database, fill in the two .env files (see SETUP.md)
npm run db           # prisma migrations
npm run seed         # full catalogue (in-repo data + images) + your accounts
npm run dev:server   # http://localhost:3000
npm run dev:client   # http://localhost:5173  (second terminal)
```

Prerequisites will be Node.js and a local PostgreSQL instance. Environment variables will be documented in `.env.example`.

---

## Scope

**Simulated, by design:**

- **Payment** — the specification defines a simulation with no real charge
- **Email delivery** — the verification and reset logic is fully implemented (single-use tokens, 24-hour expiry, orders blocked until verified); only the transport prints to the console instead of sending

**Deliberately out of scope:** real payment processing, product reviews, loyalty programmes, multi-warehouse inventory, VAT and invoicing, personalised nutritional advice.

**Runs locally.** No deployment is planned, but the code is written deployment-ready — environment variables throughout, no hardcoded paths, no secrets.

---

## AI assistant

The site includes a conversational agent that helps users find products **within the catalogue**. It translates free-language requests into the same filter criteria the regular search uses.

🔴 **It does not diagnose, does not set dosages, and does not advise changing medical treatment.** When a user mentions pregnancy, medication, a medical condition, or a concern about interactions, a fixed notice directs them to a physician or pharmacist. Products are retrieved from the database, never generated by the model.

Full rules: `ai/AI_SAFETY_RULES.md`.

---

## Disclaimer

An academic project. Not a real store — no orders are fulfilled and no payments are processed. Product information is presented for demonstration and **must not be relied on for health decisions**. Consult a physician or pharmacist before taking any supplement.

---

Last updated: 2026-08-01
