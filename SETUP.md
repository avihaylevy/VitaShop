# VitaShop — Setup for Reviewers

Everything runs locally: the full product catalogue (data **and** images)
ships inside the repo under `assets/products/`, so a fresh clone seeds a
complete store with no external downloads and no shared credentials.

## Reviewer quick start (Docker)

If you have **Docker Desktop** and nothing else, this is the whole setup:

```bash
git clone <repo-url>
cd VitaShop
cp .env.example .env      # then fill in the three required values (see below)
docker compose up
```

`.env` needs a `SESSION_SECRET` (a long random string) and the two
passwords you want for `SEED_ADMIN_PASSWORD` and `SEED_SHOPPER_PASSWORD`.
There are no defaults: Compose refuses to start with any of them empty,
exactly as the manual path does. Stick to letters and digits: Compose
treats `$` inside a value as a variable reference and drops it.

The first run builds the images and takes a few minutes; it starts
PostgreSQL, applies the migrations, seeds the full catalogue and your
accounts, then serves the API on <http://localhost:3000> and the app on
<http://localhost:5173>. Both ports must be free, and the app is built for
exactly those two `localhost` addresses. Log in with `admin@vitashop.local`
/ `shopper@vitashop.local` and the passwords you chose.

Stop with Ctrl+C. A later `docker compose up` keeps your data: the
catalogue is seeded once per database, so admin edits and orders survive a
restart (the accounts are re-hashed from `.env` each time, which is how you
change a password). `docker compose down -v` deletes the volumes and starts
over from a clean, re-seeded database.

A brand-new account's verification email is printed in the `server`
container's log (`docker compose logs server`), link included.

The rest of this document is the manual path (Node 24 + your own
PostgreSQL). The Compose setup runs the same migrations, seed and servers,
but as a production build (`vite preview`, compiled server) rather than the
dev servers below, so the dev-only diagnostics are absent there.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24.x | both packages pin `>=24 <25` |
| PostgreSQL | any recent (15+) | running locally — installation options in step 0 |
| npm | ships with Node | |

## 0. Installing PostgreSQL (if you don't have it)

Any one of these gives you a local server:

- **Windows** — download the installer from
  <https://www.postgresql.org/download/windows/>, run it, and note the
  password you choose for the `postgres` user during installation (it goes
  into `DATABASE_URL` in step 3). Keep the default port 5432.
- **macOS** — `brew install postgresql@16 && brew services start postgresql@16`
- **Docker** (any OS, no install) —
  ```bash
  docker run --name vitashop-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16
  ```
  With this option the `DATABASE_URL` user/password in step 3 are
  `postgres`/`postgres`.

To open a SQL prompt for step 2: `psql -U postgres` (Windows: use the
"SQL Shell (psql)" app the installer adds; Docker:
`docker exec -it vitashop-pg psql -U postgres`).

## 1. Clone and install

```bash
git clone <repo-url>
cd VitaShop
npm run setup
```

One command — it installs the server's and the client's dependencies
(the root `package.json` holds convenience scripts only; nothing is
installed at the root itself).

## 2. Create the database

Create an empty local database, e.g.:

```sql
CREATE DATABASE vitashop_dev;
```

> The seed scripts deliberately refuse any database that is not a
> localhost `vitashop_dev` — a safety rail, not a suggestion.

## 3. Configure the server

```bash
cd server
cp .env.example .env
```

Fill in `.env` (never committed — see `.gitignore`):

- `DATABASE_URL` — e.g. `postgresql://postgres:<your-password>@localhost:5432/vitashop_dev?schema=public`
- `SESSION_SECRET` — generate your own:
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
- **Your login accounts** — pick any passwords you like; they exist only in
  your local database:
  - `SEED_ADMIN_PASSWORD` — full admin
  - `SEED_SHOPPER_PASSWORD` — ordinary customer
  - `SEED_REVIEWER_PASSWORD` — optional second admin (same as filling admin;
    exists so a reviewer identity is separable in the order history)

  There are **no default passwords anywhere** — the seeder refuses to run
  with these unset rather than invent one.

Everything else in `.env.example` already carries the right local value
(`CLIENT_ORIGIN`, `PORT`, `AI_PROVIDER=mock`). Leave `GROQ_API_KEY` empty —
the AI agent then runs against the built-in deterministic mock provider,
which is the supported review configuration.

## 4. Configure the client

```bash
cd ../client
cp .env.example .env
```

The single value it contains (`VITE_API_BASE_URL=http://localhost:3000`)
is already correct for local review.

## 5. Migrate, seed, run

From the repo root:

```bash
npm run db                 # creates the schema (prisma migrate dev)
npm run seed               # full catalogue (50 real products, 8 brands,
                           # images) + your logins from .env
npm run dev:server         # server on http://localhost:3000
```

In a second terminal, from the repo root:

```bash
npm run dev:client         # app on http://localhost:5173
```

Open <http://localhost:5173>. Log in with the email/password pairs you set
in step 3 (`SEED_ADMIN_EMAIL` defaults to `admin@vitashop.local`, etc.).
The admin menu (products, orders, dashboard) appears for the admin and
reviewer accounts.

**Registering a brand-new account?** The verification email is not sent
anywhere: the server prints it, link included, in the terminal that runs
`npm run dev:server`. Open that link to verify the account; until then it
cannot check out. The seeded accounts above are already verified, so for
a quick review use those.

## Tests

```bash
npm test                   # both suites, from the repo root
```

(The server's integration tests need the database up.)

## Troubleshooting

- **Docker build fails in `npm ci` with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`** →
  an antivirus or proxy on your machine is intercepting HTTPS (AVG/Avast
  "Web Shield" HTTPS scanning does this). Pause that scanning for the first
  build, which is the only step that downloads anything, then turn it back on.
- **Docker Desktop crashes at start with "remove … .sock: The file cannot be
  accessed by the system"** → a stale socket file from an earlier crash.
  Rename the folder it names (e.g. `%LOCALAPPDATA%\Docker
un`) and start
  Docker Desktop again; it recreates the folder.
- **Server refuses to start** → `SESSION_SECRET` is missing; that refusal is
  by design.
- **`seed:accounts` refuses to run** → one of the `SEED_*_PASSWORD` values is
  empty, or `DATABASE_URL` points at something other than localhost
  `vitashop_dev`.
- **App loads but products error** → the server isn't running on port 3000,
  or `VITE_API_BASE_URL` was changed.
- Re-running `npm run seed` or `npm run seed:accounts` is always safe: the
  seed converges CSV-known products to the CSV source of truth, account
  seeding re-hashes the passwords currently in your `.env`, and products
  created through the **admin panel** are left untouched — the seed governs
  only the slugs the CSV knows.
