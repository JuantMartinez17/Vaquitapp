# Vaquitapp — Backend

API de **gastos compartidos** (estilo Splitwise / "armar una vaquita"): hogares,
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

| Script                                 | Qué hace                                 |
| -------------------------------------- | ---------------------------------------- |
| `npm run dev`                          | Servidor con hot reload (tsx)            |
| `npm run build`                        | Compila TypeScript a `dist/`             |
| `npm start`                            | Corre la build (`node dist/server.js`)   |
| `npm run typecheck`                    | Type check sin emitir (`tsc --noEmit`)   |
| `npm run lint` / `lint:fix`            | ESLint                                   |
| `npm run format` / `format:check`      | Prettier                                 |
| `npm test`                             | `test:unit` + `test:integration`         |
| `npm run test:unit`                    | Dominio puro, sin base (`*.test.ts`)     |
| `npm run test:integration`             | Contra Postgres (`*.itest.ts`)           |
| `npm run test:watch` / `test:coverage` | Tests con el runner nativo (`node:test`) |
| `npm run prisma:generate`              | Genera el cliente de Prisma              |
| `npm run prisma:migrate`               | Crea/aplica migraciones (dev)            |
| `npm run prisma:studio`                | GUI de la base                           |
| `npm run prisma:seed`                  | Seed de monedas y categorías             |

## Estructura

```
src/
├── app/                    # app.ts (Express: middlewares, health, router) + config.ts + middleware/
├── server.ts               # Arranque + graceful shutdown
├── modules/<name>/         # un módulo por dominio (routes/controller/service/schema/mapper)
├── domain/                 # puro: sin Express, sin Prisma — money/, splitting/
├── infrastructure/         # database/ (cliente Prisma)
└── shared/                 # errors/, types/, utils/ (asyncHandler, pagination, duration)
prisma/                     # schema, migraciones y seed
docs/                       # SPECS.md — spec técnico-funcional del producto
```

### Convenciones de código

Están en **[CODESTYLE.md](CODESTYLE.md)**: idioma, commits, código depurable, comentarios y
estructura de módulos. Casi todas las hace cumplir la máquina — `npm install` deja los hooks
de git instalados (script `prepare`):

| Hook         | Qué corre                                                             |
| ------------ | --------------------------------------------------------------------- |
| `pre-commit` | `lint-staged`: Prettier + ESLint (`--max-warnings 0`) sobre lo staged |
| `commit-msg` | `commitlint`: Conventional Commits, en inglés                         |

Lo esencial: **el código y los commits se escriben en inglés**, los montos son siempre
`Decimal`, la capa `domain/` no importa Express ni Prisma (lo corta ESLint), y no se usa
`--no-verify`.

### Convenciones de la API

- **Errores**: respuesta uniforme `{ error: { code, message, details? } }`. Se lanzan
  las clases de [`src/shared/errors/errors.ts`](src/shared/errors/errors.ts) (`NotFoundError`,
  `ForbiddenError`, etc.) y las centraliza
  [`error.middleware.ts`](src/app/middleware/error.middleware.ts).
- **Async**: todo handler async se envuelve en
  [`asyncHandler`](src/shared/utils/asyncHandler.ts).
- **Validación**: [`validate.middleware.ts`](src/app/middleware/validate.middleware.ts) con
  schemas Zod (`body`/`params`/`query`). El query validado vive en `req.validatedQuery`.
- **Dinero**: montos siempre en `Decimal`; en JSON viajan como **string**. La división de
  gastos usa [`allocate`](src/domain/splitting/allocate.ts) (método del mayor resto) para que la
  suma de las partes sea exactamente el total.
- **Paginación**: cursor-based con [`pagination.ts`](src/shared/utils/pagination.ts).
- **Auth**: bearer token (`Authorization: Bearer <access>`); refresh con rotación.
- **Autorización**: rutas household-scoped protegidas con `requireHouseholdMember(role?)`
  ([`authorization.middleware.ts`](src/app/middleware/authorization.middleware.ts)); valida
  membresía activa y, opcionalmente, rol `admin`. Carga `req.membership`.

### Endpoints (v1)

Base: `/api/v1`. Los marcados con 🔒 requieren `Authorization: Bearer <accessToken>`.

| Método | Ruta                                  | Descripción                                                                    |
| ------ | ------------------------------------- | ------------------------------------------------------------------------------ |
| POST   | `/auth/register`                      | Crea usuario y devuelve `{ user, accessToken, refreshToken }`                  |
| POST   | `/auth/login`                         | Login con email + password                                                     |
| POST   | `/auth/refresh`                       | Rota el refresh token y devuelve un nuevo par                                  |
| POST   | `/auth/logout`                        | Revoca el refresh token recibido                                               |
| POST   | `/auth/logout-all`                    | 🔒 Revoca todas las sesiones del usuario                                       |
| GET    | `/users/me`                           | 🔒 Perfil del usuario autenticado                                              |
| PATCH  | `/users/me`                           | 🔒 Actualiza `displayName` / `avatarUrl` / `preferredCurrencyCode`             |
| GET    | `/users/me/invitations`               | 🔒 Mis invitaciones pendientes (por email)                                     |
| POST   | `/households`                         | 🔒 Crea un hogar (el creador queda como `admin`)                               |
| GET    | `/households`                         | 🔒 Lista los hogares del usuario (con su rol y cantidad de miembros)           |
| GET    | `/households/:id`                     | 🔒 Detalle del hogar (solo miembros)                                           |
| PATCH  | `/households/:id`                     | 🔒 Actualiza el hogar (solo admin)                                             |
| DELETE | `/households/:id`                     | 🔒 Borra el hogar (soft delete, solo admin)                                    |
| GET    | `/households/:id/members`             | 🔒 Lista miembros activos (solo miembros)                                      |
| PATCH  | `/households/:id/members/:userId`     | 🔒 Cambia el rol de un miembro (solo admin)                                    |
| DELETE | `/households/:id/members/:userId`     | 🔒 Quita un miembro (solo admin)                                               |
| POST   | `/households/:id/invitations`         | 🔒 Invita por email (solo admin)                                               |
| GET    | `/households/:id/invitations`         | 🔒 Invitaciones del hogar, todos los estados (solo admin)                      |
| DELETE | `/households/:id/invitations/:id`     | 🔒 Revoca una invitación pendiente (solo admin)                                |
| POST   | `/invitations/:token/accept`          | 🔒 Acepta una invitación (solo el invitado)                                    |
| POST   | `/invitations/:token/reject`          | 🔒 Rechaza una invitación (solo el invitado)                                   |
| GET    | `/categories`                         | Catálogo global de categorías (de sistema)                                     |
| GET    | `/households/:id/categories`          | 🔒 Globales + propias del hogar                                                |
| POST   | `/households/:id/categories`          | 🔒 Crea una categoría propia (solo admin)                                      |
| PATCH  | `/households/:id/categories/:id`      | 🔒 Edita una propia (solo admin)                                               |
| DELETE | `/households/:id/categories/:id`      | 🔒 Elimina una propia (soft delete, solo admin)                                |
| POST   | `/households/:id/expenses`            | 🔒 Crea un gasto con sus splits (transaccional)                                |
| GET    | `/households/:id/expenses`            | 🔒 Lista paginada + filtros (`from,to,categoryId,paidBy,participantId,status`) |
| GET    | `/households/:id/expenses/:id`        | 🔒 Detalle con splits                                                          |
| PATCH  | `/households/:id/expenses/:id`        | 🔒 Edita; cambiar el monto recalcula los splits                                |
| DELETE | `/households/:id/expenses/:id`        | 🔒 Anula (`voided`), no borra                                                  |
| GET    | `/households/:id/balances`            | 🔒 Balance neto por miembro, derivado (nunca guardado)                         |
| GET    | `/households/:id/balances/simplified` | 🔒 Deudas simplificadas: quién le paga a quién                                 |
| POST   | `/households/:id/settlements`         | 🔒 Registra un pago entre dos miembros (solo las partes)                       |
| GET    | `/households/:id/settlements`         | 🔒 Lista paginada                                                              |
| DELETE | `/households/:id/settlements/:id`     | 🔒 Anula (`voided`), no borra                                                  |
| GET    | `/currencies`                         | Catálogo de monedas soportadas                                                 |

**Tokens:** el **access** es un JWT corto (15m). El **refresh** es un string opaco (30d) del
que solo se guarda su hash; en cada `/auth/refresh` se rota y, si se reutiliza uno ya revocado,
se revocan todas las sesiones (defensa ante robo de token).

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

El backend se construye por fases (auth → hogares → invitaciones → gastos/splits →
balances/settlements → recurrentes → adjuntos/multi-moneda → reportes/hardening →
OpenAPI/CI/CD). Cada fase es entregable y testeable por separado.
