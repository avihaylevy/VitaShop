# VitaShop — reviewer images (DEC-114: the project runs locally; this file
# exists so "locally" needs Docker Desktop only, not Node 24 + PostgreSQL).
#
# One Dockerfile, one build CONTEXT (the repo root), three stages:
#   server-tools   full server tree (dev deps: prisma CLI, tsx) — runs the
#                  one-shot migrate + seed, and compiles dist/ for the next
#   server         runtime API: production deps + dist/ + generated client
#   client         the built React app served by `vite preview`
# The context is the repo root because BOTH tiers read `assets/products/`
# in place — the seed by path (DEC-016), the client by `import.meta.glob`
# (ISSUE-040). Copying assets/ into the images keeps that single source of
# truth; nothing is duplicated in git.
#
# glibc base (bookworm-slim), not alpine: argon2 ships prebuilt binaries
# for it, so no compiler toolchain is needed in any stage.

# ── server-tools: everything the seed and the compiler need ─────────────
FROM node:24-bookworm-slim AS server-tools
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
# Generate before the source lands so a route edit does not regenerate.
# prisma.config.ts resolves DATABASE_URL when it LOADS, so even `generate`
# (which never opens a connection) demands one; a placeholder satisfies the
# load and the real URL arrives from compose.yaml at run time.
COPY server/prisma.config.ts ./
COPY server/prisma/schema.prisma ./prisma/
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate
COPY server/ ./
RUN npm run build
# The seed reads assets/products/*.csv from the repo root (two levels up).
# Last, so an asset edit rebuilds nothing above it.
COPY assets/products/ /app/assets/products/

# ── server: the API, without the toolchain ─────────────────────────────
FROM node:24-bookworm-slim AS server
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
# --omit=peer: @prisma/client lists the prisma CLI and typescript as peers,
# which would drag the whole toolchain (~600 MB) back in. Cache dropped in
# the same layer so it never lands in the image.
RUN npm ci --omit=dev --omit=peer --omit=optional --no-audit --no-fund  && npm cache clean --force
COPY --from=server-tools /app/server/node_modules/.prisma ./node_modules/.prisma
COPY --from=server-tools /app/server/dist ./dist
# node directly: no npm wrapper process in the runtime image.
CMD ["node", "dist/src/index.js"]

# ── client ─────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
COPY assets/products/ /app/assets/products/
# Baked into the bundle at build time (Vite inlines VITE_*). It is what the
# reviewer's BROWSER calls, so it stays localhost even though the containers
# talk to each other by service name. Changing it means rebuilding.
ARG VITE_API_BASE_URL=http://localhost:3000
RUN npm run build
# --strictPort: if 5173 is taken, fail loudly instead of drifting to 5174
# behind a port mapping that still says 5173.
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]
