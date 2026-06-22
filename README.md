# Vaquitapp — Backend

API de **gastos compartidos** (estilo Splitwise / "armar una vaquita"): grupos,
gastos divididos de varias formas, cálculo de quién le debe a quién, settlements,
gastos recurrentes, adjuntos y multi-moneda.

## Stack

- **Node.js 20+** · **TypeScript** (ESM, `NodeNext`)
- **Express 5** — HTTP framework
- **Prisma 7** + **PostgreSQL 16** (adapter `@prisma/adapter-pg`)
- **Zod** — validación (env, DTOs)
- **JWT** (access + refresh con rotación) · **bcrypt** — auth
- **Pino** — logging estructurado · **Helmet** + **CORS** — seguridad
- **Decimal.js** — aritmética de dinero (nunca floats)
- **node:test** (runner nativo de Node, vía `tsx`) + **Supertest** — tests · **ESLint** + **Prettier** — calidad

## Requisitos

- Node.js >= 20
- Docker (para PostgreSQL en local)

## Puesta en marcha (local)

```bash
# 1. Instalar dependencias
npm install

# 2. Variables de entorno
cp .env.example .env        # completá POSTGRES_PASSWORD, los JWT_*, y que DATABASE_URL use esa misma clave

# 3. Levantar PostgreSQL
docker compose up -d postgres

# 4. Generar el cliente de Prisma + aplicar migraciones + seed
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed         # carga monedas y categorías de sistema

# 5. Levantar la API en modo dev (hot reload)
npm run dev
```

La API queda en `http://localhost:3000`. Health checks:

- `GET /health` — liveness
- `GET /health/ready` — readiness (verifica la conexión a la base)

## Scripts

| Script                                      | Qué hace                                 |
| ------------------------------------------- | ---------------------------------------- |
| `npm run dev`                               | Servidor con hot reload (tsx)            |
| `npm run build`                             | Compila TypeScript a `dist/`             |
| `npm start`                                 | Corre la build (`node dist/server.js`)   |
| `npm run typecheck`                         | Type check sin emitir (`tsc --noEmit`)   |
| `npm run lint` / `lint:fix`                 | ESLint                                   |
| `npm run format` / `format:check`           | Prettier                                 |
| `npm test` / `test:watch` / `test:coverage` | Tests con el runner nativo (`node:test`) |
| `npm run prisma:generate`                   | Genera el cliente de Prisma              |
| `npm run prisma:migrate`                    | Crea/aplica migraciones (dev)            |
| `npm run prisma:studio`                     | GUI de la base                           |
| `npm run prisma:seed`                       | Seed de monedas y categorías             |

## Estructura

```
src/
├── app.ts                 # Configuración de Express (middlewares, health, router)
├── server.ts              # Arranque + graceful shutdown
├── config/                # env (validado con Zod) y cliente Prisma
├── middlewares/           # error, validate, auth
├── modules/<name>/        # un módulo por dominio (routes/controller/service/schema/mapper)
├── utils/                 # errors, asyncHandler, money, pagination
└── types/                 # augmentations de tipos (Express.Request)
prisma/                    # schema, migraciones y seed
```

### Convenciones de la API

- **Errores**: respuesta uniforme `{ error: { code, message, details? } }`. Se lanzan
  las clases de [`src/utils/errors.ts`](src/utils/errors.ts) (`NotFoundError`,
  `ForbiddenError`, etc.) y las centraliza [`error.middleware.ts`](src/middlewares/error.middleware.ts).
- **Async**: todo handler async se envuelve en [`asyncHandler`](src/utils/asyncHandler.ts).
- **Validación**: [`validate.middleware.ts`](src/middlewares/validate.middleware.ts) con
  schemas Zod (`body`/`params`/`query`). El query validado vive en `req.validatedQuery`.
- **Dinero**: montos siempre en `Decimal`; en JSON viajan como **string**. La división de
  gastos usa [`allocate`](src/utils/money.ts) (método del mayor resto) para que la suma
  de las partes sea exactamente el total.
- **Paginación**: cursor-based con [`pagination.ts`](src/utils/pagination.ts).
- **Auth**: bearer token (`Authorization: Bearer <access>`); refresh con rotación.

## Tests

Usamos el **runner nativo de Node** (`node:test`) ejecutado con `tsx`. No depende de
binarios nativos (Vite/Rollup), así que corre igual en cualquier máquina y en CI.

```bash
npm test             # unit + integración (una vez)
npm run test:watch   # modo watch
npm run test:coverage
```

La lógica pura (dinero, balances, simplificación de deudas) se testea sin base de datos.
Los tests de integración corren contra un PostgreSQL desechable.

## Flujo de ramas y entornos

Modelo por entorno:

| Rama                | Entorno              | Deploy                  |
| ------------------- | -------------------- | ----------------------- |
| `develop` (default) | desarrollo / testing | auto                    |
| `staging`           | pre-producción / QA  | auto                    |
| `main`              | **producción**       | manual (con aprobación) |

- Trabajo en ramas cortas: `feature/*`, `fix/*`, `chore/*` desde `develop`.
- Promoción vía PR: `feature/*` → `develop` → `staging` → `main`.
- **Hotfix**: rama desde `main`, PR a `main`, y back-merge a `staging` y `develop`.
- `main`/`staging`/`develop` protegidas: PR obligatorio + CI en verde.
- Mensajes de commit en formato **Conventional Commits** (`feat:`, `fix:`, `chore:`…).

## Deploy (Render)

Un Web Service por entorno (`dev`←develop, `staging`←staging, `prod`←main):

- **Build**: `npm ci && npx prisma generate && npm run build`
- **Pre-Deploy**: `npx prisma migrate deploy` (migraciones antes de activar la versión)
- **Start**: `node dist/server.js`
- **Health Check Path**: `/health/ready`
- **Auto-Deploy**: "After CI Checks Pass" (no se despliega un build roto)

Un PostgreSQL gestionado por entorno. Secrets (JWT nuevos por entorno, S3, SMTP, Sentry)
se configuran en Render, nunca en el repo.

## Roadmap

El backend se construye por fases (auth → grupos → invitaciones → gastos/splits →
balances/settlements → recurrentes → adjuntos/multi-moneda → reportes/hardening →
OpenAPI/CI/CD). Cada fase es entregable y testeable por separado.
