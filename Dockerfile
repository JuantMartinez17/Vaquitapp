# syntax=docker/dockerfile:1

# ---- deps: install once with the lockfile, reused by the build stage ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `prepare` installs git hooks (husky) — meaningless with no .git directory
# in the build context, so it's dropped rather than left to fail or no-op.
RUN npm pkg delete scripts.prepare && npm ci

# ---- build: generate the Prisma client and compile TypeScript ----
FROM deps AS build
COPY . .
# `prisma generate` only reads the schema — it never connects — but
# prisma.config.ts still requires DATABASE_URL to resolve to load at all.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npx prisma generate
RUN npm run build

# ---- prod-deps: a separate install with devDependencies stripped ----
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
# See the `deps` stage above: --omit=dev also strips the `husky` package
# itself, so leaving `prepare` in place would fail with "husky: not found".
RUN npm pkg delete scripts.prepare && npm ci --omit=dev

# ---- runtime: the image that actually ships ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
# dist/generated/prisma is the compiled Prisma client: the "prisma-client"
# generator (schema.prisma) is configured with a TS output path, so `tsc`
# compiles it as ordinary source — there is no separate native/wasm engine
# artifact to copy, since this project uses @prisma/adapter-pg instead of
# Prisma's bundled query engine binary.
COPY --from=build /app/dist ./dist
COPY package.json ./
# Needed by `prisma migrate deploy`, run as Render's Pre-Deploy step against
# this same image (see README.md § Deploy) — schema, migration SQL, and the
# `prisma` CLI, which is why `prisma` lives in dependencies, not devDependencies.
COPY prisma.config.ts ./
COPY prisma ./prisma

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
