# Vaquitapp — Backend

**Una agenda económica del hogar en la que compartir gastos es una capacidad de primera clase.**

No responde solo _"¿quién le debe a quién?"_ (eso ya lo hacía Splitwise), sino _"¿qué pasó con
nuestra plata, a dónde se fue y qué viene después?"_: hogares, gastos divididos de cuatro
formas, ingresos, transferencias, balances derivados, settlements, gastos recurrentes,
comprobantes adjuntos y analytics.

La especificación de producto vive en [`docs/SPECS.md`](docs/SPECS.md); los casos de uso, en
[`docs/specs/`](docs/specs/).

## Stack

- **Node.js 20+** · **TypeScript** (ESM, `NodeNext`)
- **Express 5** — HTTP framework
- **Prisma 7** + **PostgreSQL 16** (adapter `@prisma/adapter-pg`)
- **Zod** — validación (env, DTOs)
- **JWT** (access + refresh con rotación) · **bcrypt** — auth
- **Pino** — logging estructurado · **Helmet** + **CORS** — seguridad
- **Decimal.js** — aritmética de dinero (nunca floats)
- **Multer** (upload) + **AWS SDK v3** — adjuntos, detrás de la abstracción `FileStorage`
  (`local` en dev, `s3` en producción)
- **express-rate-limit** — protección de `/auth/*`
- **OpenAPI 3.1** generado desde los schemas Zod, servido con Swagger UI en `/docs`
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

La API queda en `http://localhost:3000`:

- `GET /health` — liveness
- `GET /health/ready` — readiness (verifica la conexión a la base)
- `GET /docs` — **Swagger UI**, generado desde los mismos schemas Zod que validan cada
  request (no puede desfasarse del comportamiento real)
- `GET /docs/openapi.json` — la spec OpenAPI cruda

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
├── server.ts               # Arranque, scheduler y graceful shutdown
├── app/
│   ├── app.ts              # Express: middlewares globales, health, /docs, router /api/v1
│   ├── config.ts           # env validado con Zod (si falta algo, el proceso no levanta)
│   └── middleware/         # auth · authorization · validate · error · idempotency · rate-limit
├── modules/<name>/         # un módulo por dominio (routes/controller/service/schema/mapper)
├── domain/                 # ⭐ puro: sin Express, sin Prisma (lo corta ESLint)
│   ├── money/              # Decimal, redondeo por moneda, formato
│   ├── splitting/          # allocate (mayor resto) + las 4 estrategias
│   ├── balances/           # (actividad) → balances + simplificación de deudas
│   ├── recurrence/         # cálculo de próximas ocurrencias
│   └── files/              # sniffing de MIME por magic bytes
├── infrastructure/
│   ├── database/           # cliente Prisma
│   ├── storage/            # FileStorage: local | s3
│   ├── logging/            # Pino
│   ├── scheduler/          # runner genérico de jobs periódicos
│   └── openapi/            # spec generada desde los schemas Zod
└── shared/                 # errors/ (+ catálogo de codes) · types/ · utils/ · testing/
prisma/                     # schema, migraciones y seed
docs/
├── SPECS.md                # spec técnico-funcional del producto
├── specs/                  # una spec por caso de uso
└── runbooks/               # restore-drill.md
```

Los módulos implementados son: `auth`, `users`, `households`, `invitations`, `categories`,
`currencies`, `expenses`, `settlements`, `balances`, `incomes`, `transfers`, `activity`,
`recurring-expenses`, `attachments` y `analytics`.

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
  `?limit=&cursor=` (default 20, máximo 100) y la respuesta es
  `{ data: [...], nextCursor: string | null }`. No hay `page` ni `total`: ningún endpoint
  devuelve un histórico sin acotar.
- **Fechas**: las de negocio (`expenseDate`, `incomeDate`, `settlementDate`…) son **fechas
  civiles** `YYYY-MM-DD`, sin hora ni zona. Los timestamps de sistema (`createdAt`…) son
  ISO-8601 en UTC.
- **Trazabilidad**: cada respuesta lleva `X-Request-Id` (se reusa el entrante si viene), y ese
  id aparece en los logs de Pino.
- **Auth**: bearer token (`Authorization: Bearer <access>`); refresh con rotación.
- **Autorización**: rutas household-scoped protegidas con `requireHouseholdMember(role?)`
  ([`authorization.middleware.ts`](src/app/middleware/authorization.middleware.ts)); valida
  membresía activa y, opcionalmente, rol `admin`. Carga `req.membership`.
- **Idempotencia**: header `Idempotency-Key` (UUID) **obligatorio** al crear gastos,
  settlements e incomes. Repetir la misma key con el mismo body devuelve la respuesta
  original en vez de duplicar; con un body distinto, `409 IDEMPOTENCY_KEY_CONFLICT`
  ([`idempotency.middleware.ts`](src/app/middleware/idempotency.middleware.ts)).
- **Rate limiting**: `/auth/register`, `/auth/login` y `/auth/refresh` limitan a
  `AUTH_RATE_LIMIT_MAX` intentos por IP cada `AUTH_RATE_LIMIT_WINDOW_MS` (`429 RATE_LIMITED`).

### Endpoints (v1)

Base: `/api/v1`. Los marcados con 🔒 requieren `Authorization: Bearer <accessToken>`.

| Método | Ruta                                          | Descripción                                                                    |
| ------ | --------------------------------------------- | ------------------------------------------------------------------------------ |
| POST   | `/auth/register`                              | Crea usuario y devuelve `{ user, accessToken, refreshToken }`                  |
| POST   | `/auth/login`                                 | Login con email + password                                                     |
| POST   | `/auth/refresh`                               | Rota el refresh token y devuelve un nuevo par                                  |
| POST   | `/auth/logout`                                | Revoca el refresh token recibido                                               |
| POST   | `/auth/logout-all`                            | 🔒 Revoca todas las sesiones del usuario                                       |
| GET    | `/users/me`                                   | 🔒 Perfil del usuario autenticado                                              |
| PATCH  | `/users/me`                                   | 🔒 Actualiza `displayName` / `avatarUrl` / `preferredCurrencyCode`             |
| GET    | `/users/me/invitations`                       | 🔒 Mis invitaciones pendientes (por email)                                     |
| POST   | `/households`                                 | 🔒 Crea un hogar (el creador queda como `admin`)                               |
| GET    | `/households`                                 | 🔒 Lista los hogares del usuario (con su rol y cantidad de miembros)           |
| GET    | `/households/:id`                             | 🔒 Detalle del hogar (solo miembros)                                           |
| PATCH  | `/households/:id`                             | 🔒 Actualiza el hogar (solo admin)                                             |
| DELETE | `/households/:id`                             | 🔒 Borra el hogar (soft delete, solo admin)                                    |
| GET    | `/households/:id/members`                     | 🔒 Lista miembros activos (solo miembros)                                      |
| PATCH  | `/households/:id/members/:userId`             | 🔒 Cambia el rol de un miembro (solo admin)                                    |
| DELETE | `/households/:id/members/:userId`             | 🔒 Quita un miembro (solo admin)                                               |
| POST   | `/households/:id/invitations`                 | 🔒 Invita por email (solo admin)                                               |
| GET    | `/households/:id/invitations`                 | 🔒 Invitaciones del hogar, todos los estados (solo admin)                      |
| DELETE | `/households/:id/invitations/:id`             | 🔒 Revoca una invitación pendiente (solo admin)                                |
| POST   | `/invitations/:token/accept`                  | 🔒 Acepta una invitación (solo el invitado)                                    |
| POST   | `/invitations/:token/reject`                  | 🔒 Rechaza una invitación (solo el invitado)                                   |
| GET    | `/categories`                                 | Catálogo global de categorías (de sistema)                                     |
| GET    | `/households/:id/categories`                  | 🔒 Globales + propias del hogar                                                |
| POST   | `/households/:id/categories`                  | 🔒 Crea una categoría propia (solo admin)                                      |
| PATCH  | `/households/:id/categories/:id`              | 🔒 Edita una propia (solo admin)                                               |
| DELETE | `/households/:id/categories/:id`              | 🔒 Elimina una propia (soft delete, solo admin)                                |
| POST   | `/households/:id/expenses`                    | 🔒 Crea un gasto con sus splits (transaccional)                                |
| GET    | `/households/:id/expenses`                    | 🔒 Lista paginada + filtros (`from,to,categoryId,paidBy,participantId,status`) |
| GET    | `/households/:id/expenses/:id`                | 🔒 Detalle con splits                                                          |
| PATCH  | `/households/:id/expenses/:id`                | 🔒 Edita; cambiar el monto recalcula los splits                                |
| DELETE | `/households/:id/expenses/:id`                | 🔒 Anula (`voided`), no borra                                                  |
| POST   | `/households/:id/expenses/:id/confirm`        | 🔒 Confirma una ocurrencia `pending` (pasa a `active`)                         |
| POST   | `/households/:id/expenses/:id/skip`           | 🔒 Omite una ocurrencia `pending` (pasa a `voided`)                            |
| GET    | `/households/:id/balances`                    | 🔒 Balance neto por miembro, derivado (nunca guardado)                         |
| GET    | `/households/:id/balances/simplified`         | 🔒 Deudas simplificadas: quién le paga a quién                                 |
| POST   | `/households/:id/settlements`                 | 🔒 Registra un pago entre dos miembros (solo las partes)                       |
| GET    | `/households/:id/settlements`                 | 🔒 Lista paginada                                                              |
| DELETE | `/households/:id/settlements/:id`             | 🔒 Anula (`voided`), no borra                                                  |
| POST   | `/households/:id/incomes`                     | 🔒 Registra un ingreso (no mueve balances)                                     |
| GET    | `/households/:id/incomes`                     | 🔒 Lista paginada                                                              |
| PATCH  | `/households/:id/incomes/:id`                 | 🔒 Edita                                                                       |
| DELETE | `/households/:id/incomes/:id`                 | 🔒 Anula (`voided`), no borra                                                  |
| POST   | `/households/:id/transfers`                   | 🔒 Registra una transferencia (no mueve balances, solo las partes)             |
| GET    | `/households/:id/transfers`                   | 🔒 Lista paginada                                                              |
| DELETE | `/households/:id/transfers/:id`               | 🔒 Anula (`voided`), no borra                                                  |
| GET    | `/households/:id/activity`                    | 🔒 Timeline unificado: gastos + ingresos + transferencias + settlements        |
| POST   | `/households/:id/recurring-expenses`          | 🔒 Define un gasto recurrente                                                  |
| GET    | `/households/:id/recurring-expenses`          | 🔒 Lista                                                                       |
| GET    | `/households/:id/recurring-expenses/upcoming` | 🔒 Próximos vencimientos y atrasados                                           |
| PATCH  | `/households/:id/recurring-expenses/:id`      | 🔒 Edita / activa / desactiva                                                  |
| DELETE | `/households/:id/recurring-expenses/:id`      | 🔒 Elimina (soft delete)                                                       |
| POST   | `/households/:id/expenses/:id/attachments`    | 🔒 Sube un comprobante (multipart, campo `file`)                               |
| GET    | `/households/:id/expenses/:id/attachments`    | 🔒 Lista adjuntos                                                              |
| GET    | `/.../attachments/:attId/download`            | 🔒 URL prefirmada de descarga (5 min)                                          |
| DELETE | `/.../attachments/:attId`                     | 🔒 Elimina un adjunto                                                          |
| GET    | `/households/:id/analytics/summary`           | 🔒 Total gastado, total ingresado, neto (`?from=&to=` obligatorio)             |
| GET    | `/households/:id/analytics/by-category`       | 🔒 Gasto por categoría en el rango                                             |
| GET    | `/households/:id/analytics/by-member`         | 🔒 Gasto por miembro (por su parte del split) en el rango                      |
| GET    | `/households/:id/analytics/over-time`         | 🔒 Serie temporal (`?granularity=day\|week\|month`)                            |
| GET    | `/households/:id/analytics/comparison`        | 🔒 Rango actual vs. el período anterior de igual duración                      |
| GET    | `/currencies`                                 | Catálogo de monedas soportadas                                                 |

**Tokens:** el **access** es un JWT corto (15m). El **refresh** es un string opaco (30d) del
que solo se guarda su hash; en cada `/auth/refresh` se rota y, si se reutiliza uno ya revocado,
se revocan todas las sesiones (defensa ante robo de token).

### Catálogo de errores

Los códigos son **estables** y forman parte del contrato: el cliente renderiza texto a partir
del `code`, nunca del `message` (que está en inglés y es para debug). La lista canónica vive en
[`src/shared/errors/codes.ts`](src/shared/errors/codes.ts).

| Código                             | HTTP  | Cuándo                                                           |
| ---------------------------------- | ----- | ---------------------------------------------------------------- |
| `BAD_REQUEST`                      | `400` | Request malformado (p. ej. falta `Idempotency-Key`)              |
| `UNAUTHORIZED`                     | `401` | Token ausente, inválido o vencido                                |
| `INVALID_CREDENTIALS`              | `401` | Email o password incorrectos                                     |
| `TOKEN_REUSE_DETECTED`             | `401` | Se reusó un refresh revocado → se cierran todas las sesiones     |
| `FORBIDDEN`                        | `403` | Autenticado pero sin permiso                                     |
| `NOT_A_MEMBER`                     | `403` | No es miembro activo del hogar                                   |
| `INSUFFICIENT_ROLE`                | `403` | La acción requiere rol `admin`                                   |
| `NOT_FOUND`                        | `404` | Recurso o ruta inexistente                                       |
| `HOUSEHOLD_NOT_FOUND`              | `404` | El hogar no existe o está archivado                              |
| `INVITATION_NOT_FOUND`             | `404` | Token de invitación inexistente                                  |
| `CONFLICT`                         | `409` | Conflicto de negocio genérico                                    |
| `EMAIL_ALREADY_REGISTERED`         | `409` | Ya existe una cuenta con ese email                               |
| `LAST_ADMIN`                       | `409` | Dejaría al hogar sin administradores                             |
| `MEMBER_HAS_OPEN_BALANCE`          | `409` | Reservado: salir del hogar con balance ≠ 0 (sin uso todavía)     |
| `INVITATION_EXPIRED`               | `409` | Venció el TTL de 7 días                                          |
| `INVITATION_ALREADY_RESOLVED`      | `409` | Ya fue aceptada o rechazada                                      |
| `INVITATION_ALREADY_PENDING`       | `409` | Ya hay una invitación abierta para ese email                     |
| `ALREADY_MEMBER`                   | `409` | Esa persona ya pertenece al hogar                                |
| `EXPENSE_ALREADY_VOIDED`           | `409` | El gasto ya estaba anulado                                       |
| `SETTLEMENT_ALREADY_VOIDED`        | `409` | El settlement ya estaba anulado                                  |
| `INCOME_ALREADY_VOIDED`            | `409` | El ingreso ya estaba anulado                                     |
| `TRANSFER_ALREADY_VOIDED`          | `409` | La transferencia ya estaba anulada                               |
| `RECURRING_OCCURRENCE_NOT_PENDING` | `409` | Confirmar/omitir un gasto que no está `pending`                  |
| `IDEMPOTENCY_KEY_CONFLICT`         | `409` | Misma `Idempotency-Key` con un body distinto                     |
| `ATTACHMENT_TOO_LARGE`             | `413` | Supera `MAX_UPLOAD_BYTES` (10 MB por defecto)                    |
| `UNSUPPORTED_MEDIA_TYPE`           | `415` | Los magic bytes no son JPEG, PNG, WEBP ni PDF                    |
| `VALIDATION_ERROR`                 | `422` | El body/params/query no pasó el schema Zod (`details` por campo) |
| `INVALID_PAYER`                    | `422` | El pagador no es miembro activo                                  |
| `INVALID_PARTICIPANT`              | `422` | Algún participante no es miembro activo                          |
| `INVALID_EXPENSE_SPLIT`            | `422` | Los splits no suman el total, o los porcentajes no dan 100       |
| `INVALID_CATEGORY`                 | `422` | La categoría no es global ni del hogar                           |
| `INVALID_CURRENCY`                 | `422` | No es la moneda del hogar                                        |
| `INVALID_SETTLEMENT`               | `422` | `from == to`, monto ≤ 0, o alguien no es miembro                 |
| `INVALID_TRANSFER`                 | `422` | `from == to`, monto ≤ 0, o alguien no es miembro                 |
| `TOO_MANY_ATTACHMENTS`             | `422` | Ya hay 5 adjuntos en ese gasto                                   |
| `RATE_LIMITED`                     | `429` | Demasiados intentos en `/auth/*`                                 |
| `INTERNAL_ERROR`                   | `500` | Falla inesperada (no filtra detalles al cliente)                 |

### Reglas de negocio que conviene tener presentes

- **Nada se borra**: `DELETE` anula (`voided`). Los anulados no cuentan en balances ni analytics.
- **Los balances son derivados**, nunca un campo guardado: `Σ(balances) == 0` siempre.
- **Ingresos y transferencias no mueven balances** entre miembros; solo alimentan analytics.
- **Un hogar = una moneda** (`defaultCurrencyCode`). No hay conversión en el MVP.
- **Un hogar nunca queda sin admin**: no se puede quitar ni degradar al último.
- Un **settlement** o una **transferencia** solo los registra alguien que sea parte.
- El `PATCH` de un gasto recalcula el split de cero: `amount`, `splitType` y `participants`
  van los tres juntos o ninguno.
- Los gastos generados por un recurrente nacen en `pending` y hay que confirmarlos u omitirlos.

## Tests

Usamos el **runner nativo de Node** (`node:test`) ejecutado con `tsx`. No depende de
binarios nativos (Vite/Rollup), así que corre igual en cualquier máquina y en CI.

```bash
npm test                   # unit + integración
npm run test:unit          # solo dominio puro, sin base
npm run test:integration   # contra Postgres
npm run test:coverage
```

Dos niveles, distinguidos por la extensión del archivo:

| Sufijo       | Qué es                        | Necesita base |
| ------------ | ----------------------------- | ------------- |
| `*.test.ts`  | Unitario, dominio puro        | No            |
| `*.itest.ts` | Integración / API (Supertest) | Sí            |

La lógica financiera —`money`, `allocate`, las 4 estrategias de split, balances, simplificación
de deudas, recurrencia, sniffing de MIME— se testea **sin base de datos y sin servidor**: son
funciones puras. Las invariantes (`Σ(splits) == amount`, `Σ(balances) == 0`) son tests
explícitos.

[`scripts/test-env.mjs`](scripts/test-env.mjs) carga el entorno de test antes de los tests;
entre otras cosas sube `AUTH_RATE_LIMIT_MAX`, porque solo armar los fixtures de un archivo ya
hace decenas de llamadas reales a `/auth`.

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

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) corre en cada push/PR a esas tres
ramas: `install → format:check → lint → typecheck → migrate deploy → test → build`, contra un
Postgres desechable (servicio de GitHub Actions).

## Deploy (Render)

[`render.yaml`](render.yaml) es un Blueprint: un Web Service + un PostgreSQL gestionado por
entorno (`dev`←develop, `staging`←staging, `prod`←main), construidos desde el
[`Dockerfile`](Dockerfile) multi-stage (build compila con todas las dependencias; runtime
solo lleva `dist/`, `node_modules` de producción, y `prisma/` + la CLI de Prisma para el
Pre-Deploy). Revisar el Blueprint antes de aplicarlo — plan/región son el mínimo pago, y los
secrets marcados `sync: false` (CORS, credenciales S3) se completan a mano en el dashboard de
Render, nunca en el repo.

- **Build / Pre-Deploy / Start**: definidos por el Dockerfile — generar cliente y compilar,
  `npx prisma migrate deploy` antes de activar la versión, y `node dist/server.js`.
- **Health Check Path**: `/health/ready`.
- **Auto-Deploy**: `dev`/`staging` despliegan solo tras CI en verde ("After CI Checks Pass");
  `prod` nunca despliega automáticamente, se dispara a mano desde el dashboard.
- **Backups**: gestionados por Render en producción, retención 7 días. Procedimiento de
  restauración y verificación, ejercitado localmente, en
  [`docs/runbooks/restore-drill.md`](docs/runbooks/restore-drill.md) (D18).
- **Almacenamiento**: `dev` usa `STORAGE_PROVIDER=local`; `staging`/`prod` usan `s3` — el
  filesystem de Render es efímero, así que local perdería los adjuntos en cada deploy.

## Estado

El **MVP está completo** según la Definition of Done de [`docs/SPECS.md`](docs/SPECS.md) §41:

| Fase                                                      | Estado      |
| --------------------------------------------------------- | ----------- |
| Cimientos (TS, Express, Prisma, config, logging, errores) | ✅          |
| Autenticación y usuarios                                  | ✅          |
| Hogares, membresía e invitaciones                         | ✅          |
| Categorías                                                | ✅          |
| Gastos y las 4 estrategias de división                    | ✅          |
| Balances derivados y settlements                          | ✅          |
| Ingresos, transferencias y timeline unificado             | ✅          |
| Gastos recurrentes + job de generación                    | ✅          |
| Adjuntos con abstracción de storage                       | ✅          |
| Analytics                                                 | ✅          |
| Idempotencia, rate limiting, OpenAPI, CI/CD, Docker       | ✅          |
| Presupuestos y metas de ahorro                            | ⬜ post-MVP |

Pendientes conocidos, con su ticket implícito:

- No hay endpoint para **salir de un hogar** por cuenta propia (solo un admin puede quitar a
  alguien). El código `MEMBER_HAS_OPEN_BALANCE` ya está reservado para cuando exista.
- **Sin envío de emails**: la invitación devuelve el `token` y el link se comparte a mano.
  Tampoco hay verificación de email ni recuperación de contraseña.
- **Sin multi-moneda real**: la tabla `exchange_rates` existe pero no se usa.
- El rate limiter usa un **store en memoria**: sirve mientras la app corra en una sola
  instancia. Escalar horizontalmente requiere un store compartido.
- Las filas de `idempotency_keys` se retienen 24 h pero **todavía nada las purga**.
