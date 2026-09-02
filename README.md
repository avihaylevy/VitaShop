# VitaShop

## About

**VitaShop is an academic project, not a real product.** It is a complete
e-commerce web application for vitamins and dietary supplements, built as
a group course project for **Digital Systems Planning and Development**,
Ramat Gan Academic College, second year, summer semester 2026.

The system implements the course specification end to end: a bilingual
Hebrew/English store with a searchable catalogue, cart and checkout, user
accounts with a personal area, a customer club, an administration module
with an analytics dashboard, and an AI shopping assistant — with every
price, stock and permission decision made on the server. It runs locally
(no cloud deployment is part of the deliverable), and the shop is a
simulation throughout: no orders are fulfilled and no payments are
processed. Product photographs and safety data belong to real branded
products and are used for academic demonstration only.

---

## Tech stack

```
Client    React 18 · Vite · TypeScript · Tailwind CSS · React Router
Server    Express · TypeScript · Prisma
Database  PostgreSQL
```

**Why client and server are separate projects rather than a unified framework:** the specification defines three layers communicating by request/response, with the server as the sole source of truth for prices, stock and permissions. Physical separation makes that property demonstrable rather than merely claimed, and keeps the API surface small enough to audit.

---

## Running it

Two ways, both local (no cloud deployment is part of the deliverable):

- **Docker Desktop only:** `cp .env.example .env`, fill in the three
  required values, `docker compose up`. PostgreSQL, migrations, seed, API and app
  come up together; the store is at <http://localhost:5173>.
- **Node 24 + your own PostgreSQL:** the step-by-step walkthrough in
  [SETUP.md](SETUP.md).

---

## Repository structure

```
VitaShop/
├── README.md              you are here
├── SETUP.md               reviewer walkthrough: clone → running store
├── compose.yaml           one-command reviewer setup (Docker Desktop)
├── Dockerfile             server + client images for compose.yaml
├── package.json           root convenience scripts (setup / db / seed / dev / test)
├── assets/
│   ├── brand/             logo artwork — source/ originals, web/ derived exports
│   ├── products/          product images + seed data
│   │   ├── products.csv       one row per product — the catalogue's source of truth
│   │   ├── ingredients.csv    one row per active ingredient
│   │   └── REFERENCE.md       allowed values and fill order
│   └── ui/                icons, backgrounds
├── scripts/               asset-derivation and data-check scripts (Python)
├── client/                React frontend (Vite + TypeScript + Tailwind)
└── server/                Express backend (TypeScript + Prisma + PostgreSQL)
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

## Screenshots

The Hebrew (RTL) interface; every screen also ships in English (LTR).

### The shop

<p align="center">
  <img src="docs/screenshots/home.png" width="49%" alt="Home page">
  <img src="docs/screenshots/catalog.png" width="49%" alt="Catalog">
</p>
<p align="center"><sub><b>Home</b> — categories, health goals, new arrivals&emsp;·&emsp;<b>Catalog</b> — server-side search, filters, sorting, paging</sub></p>

<p align="center">
  <img src="docs/screenshots/product.png" width="49%" alt="Product page">
  <img src="docs/screenshots/cart.png" width="49%" alt="Cart">
</p>
<p align="center"><sub><b>Product page</b> — brand, ingredients, warnings, club pricing&emsp;·&emsp;<b>Cart</b> — live stock checks, server-side totals</sub></p>

<p align="center">
  <img src="docs/screenshots/cart-drawer.png" width="49%" alt="Cart drawer">
  <img src="docs/screenshots/favourites.png" width="49%" alt="Favourites">
</p>
<p align="center"><sub><b>Cart drawer</b> — quick "keep shopping" glance after every add&emsp;·&emsp;<b>Favourites</b> — card-sized grid, count line, one-tap add</sub></p>

### Checkout

<p align="center">
  <img src="docs/screenshots/checkout.png" width="49%" alt="Checkout — delivery method">
  <img src="docs/screenshots/payment.png" width="49%" alt="Payment — simulated">
</p>
<p align="center"><sub><b>Delivery</b> — pickup, home delivery, or a pickup point&emsp;·&emsp;<b>Payment (simulated)</b> — the card form validates client-side only; details are never transmitted or stored</sub></p>

### Accounts and AI

<p align="center">
  <img src="docs/screenshots/login.png" width="49%" alt="Log in">
  <img src="docs/screenshots/signup.png" width="49%" alt="Sign up">
</p>
<p align="center"><sub><b>Log in</b>&emsp;·&emsp;<b>Sign up</b> — live password checklist, club opt-in</sub></p>

<p align="center">
  <img src="docs/screenshots/ai-assistant.png" width="72%" alt="AI shopping assistant">
</p>
<p align="center"><sub><b>AI shopping assistant</b> — free-language search over the catalogue, with medical-safety rules</sub></p>

### Admin

<p align="center">
  <img src="docs/screenshots/admin-dashboard.png" width="49%" alt="Admin dashboard">
  <img src="docs/screenshots/admin-products.png" width="49%" alt="Product management">
</p>
<p align="center"><sub><b>Dashboard</b> — KPIs, conversion funnel, low-stock alerts&emsp;·&emsp;<b>Product management</b> — inline editing, filters, soft-delete</sub></p>

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

Prerequisites: Node.js 24 and a local PostgreSQL instance (install options in SETUP.md). Every environment variable is documented in `server/.env.example` and `client/.env.example`.

**Admin access for reviewers.** There are no default passwords anywhere in the repo. The admin account is created by `npm run seed` from the email and password *you* put in `server/.env` (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` — the seeder refuses to run without them). Log in with that pair and the admin menu (products, orders, dashboard) appears. A second `SEED_SHOPPER_*` pair gives you an ordinary customer account for the shopping flow.

**Tests.** `npm test` runs both suites — over 2,200 automated tests across server and client, including the invariants the specification calls out (no overselling, frozen order prices, soft delete only, server-side pricing).

---

## 🔴 Security

This project handles authentication, pricing and stock. A few rules are non-negotiable:

- **All price calculation, stock checking and permission verification happen server-side.** The client is never a source of truth
- **No secrets in the repository.** API keys, database passwords and session secrets live only in `.env`, which is git-ignored
- **No real AI key is needed.** The AI assistant runs on a built-in mock provider by default; a real provider is an explicit, optional configuration
- **Payment is simulated.** The card form validates format client-side only (Luhn, expiry, CVV); card details are never transmitted to the server and never stored

These rules are enforced where they matter — in the server code and its test suite (rate limiting in `server/src/lib/rateLimit.ts`, session/auth flows in `server/src/routes/auth.ts`, admin checks per-request in the route guards) — not merely documented.

---

## Maintenance agent

The mechanism the specification describes in §4.11 — an agent proposes, automated checks verify, a human approves, no agent holds write access — is three files under `.github/`:

- **Dependabot** (`dependabot.yml`) watches `client/` and `server/` and opens pull requests for outdated and vulnerable dependencies (minor/patch bumps grouped weekly per root; majors and security advisories arrive individually). It keeps the CI workflow's own actions current the same way.
- **CI** (`workflows/ci.yml`) runs on every pull request and every push to `master`: the server is built, migrated and seeded against a fresh PostgreSQL, then both test suites run. A dependency bump that breaks anything is red before anyone reads it.
- **CODEOWNERS** routes every PR to the project author, and branch protection on `master` makes that review and a green CI run mandatory — nothing merges without both. Force-pushes and branch deletion are blocked.

---

## Scope

**Simulated, by design:**

- **Payment** — the specification defines a simulation with no real charge
- **Email** — no email is actually sent. Account verification, password reset and order confirmation are implemented end to end (single-use tokens, 24-hour expiry, orders blocked until verified), but the message is written to the server console instead of being delivered; a reviewer copies the verification link from the terminal (see SETUP.md). Notifications on order-status changes (shipped, cancelled) are not included; the customer follows the status in the personal area

**Deliberately out of scope:** real payment processing, product reviews and ratings, promotions and user management in the admin module, multi-warehouse inventory, VAT and invoicing, personalised nutritional advice. The customer club (a flat 10% member discount, computed server-side) is in scope and implemented.

**Runs locally, by design.** Cloud deployment is not part of the course deliverable; the code is nonetheless written deployment-ready — environment variables throughout, no hardcoded paths, no secrets.

---

## AI assistant

The site includes a conversational agent that helps users find products **within the catalogue**. It translates free-language requests into the same filter criteria the regular search uses.

🔴 **It does not diagnose, does not set dosages, and does not advise changing medical treatment.** When a user mentions pregnancy, medication, a medical condition, or a concern about interactions, a fixed notice directs them to a physician or pharmacist. Products are retrieved from the database, never generated by the model.

These rules are **implemented in the server**, not just written down: the medical-stop triggers, the fixed referral notice, and the redaction of medical terms before any external call live in `server/src/lib/ai/` and are covered by the test suite. A clone gets the full safety behavior with no extra configuration.

---

## Disclaimer

An academic project. Not a real store — no orders are fulfilled and no payments are processed. Product information is presented for demonstration and **must not be relied on for health decisions**. Consult a physician or pharmacist before taking any supplement.

---

Last updated: 2026-08-27
