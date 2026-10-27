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
# tsconfig.build.json leaves tests out of dist/.
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
# V8's heap limit defaults to a share of the machine's RAM, which inside a
# 512 MB container can let the heap grow until the kernel OOM-kills the
# process. 320 MB leaves ~190 MB of headroom for what the heap limit does not
# cover: the Node runtime itself, native bcrypt, Buffers (uploads are held in
# memory) and the OS.
ENV NODE_OPTIONS=--max-old-space-size=320
WORKDIR /app

# tini runs as PID 1: it forwards SIGTERM to node (so graceful shutdown
# actually triggers on deploys) and reaps zombie processes, which node as
# PID 1 would not.
RUN apk add --no-cache tini

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
# dist/generated/prisma is the compiled Prisma client: the "prisma-client"
# generator (schema.prisma) is configured with a TS output path, so `tsc`
# compiles it as ordinary source — there is no separate native/wasm engine
# artifact to copy, since this project uses @prisma/adapter-pg instead of
# Prisma's bundled query engine binary.
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
# Migrations are NOT run from this image: Render Free has no pre-deploy
# step, so `prisma migrate deploy` runs from a developer machine against
# Neon's direct URL (see README § Deploy). That is why neither the prisma CLI
# nor prisma/ + prisma.config.ts ship here.

USER node

EXPOSE 3000

# No HEALTHCHECK on purpose: Render ignores the Dockerfile one and uses
# healthCheckPath (render.yaml), and a check that spawns a Node process every
# 30 s is real CPU on a 0.1 vCPU instance.

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
