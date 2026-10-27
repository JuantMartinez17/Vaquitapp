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
- **express-rate-limit** — límites por IP en `/auth/*` y global sobre `/api/v1`
- **OpenAPI 3.0.3** generado desde los schemas Zod, servido con Swagger UI en `/docs` y
  versionado como `openapi.yaml` en la raíz
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

- `GET /health` — liveness: no toca la base (es el health check de Render)
- `GET /health/ready` — readiness: ping a la base con timeout de 2 s; si no responde, `503`
- `GET /docs` — **Swagger UI**, generado desde los mismos schemas Zod que validan cada
  request (no puede desfasarse del comportamiento real)
- `GET /docs/openapi.json` — la spec OpenAPI cruda

Los sondeos de `/health` y `/health/ready` no se loguean (ahogarían el tráfico real).

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

## Variables de entorno

Las valida [`src/app/config.ts`](src/app/config.ts) con Zod: si falta o es inválida alguna,
el proceso **no arranca** y dice cuál. [`.env.example`](.env.example) tiene la plantilla.

| Variable                       | Default                 | Para qué                                                                                |
| ------------------------------ | ----------------------- | --------------------------------------------------------------------------------------- |
| `NODE_ENV`                     | `development`           | `development` \| `production` \| `test`. En `production` rigen los guard rails de abajo |
| `PORT`                         | `3000`                  | Puerto HTTP                                                                             |
| `DATABASE_URL`                 | — (obligatoria)         | `postgres://` o `postgresql://`. En Neon: la URL **pooled** para la app                 |
| `JWT_ACCESS_SECRET`            | — (obligatoria, ≥ 32)   | Firma del access token                                                                  |
| `JWT_REFRESH_SECRET`           | — (obligatoria, ≥ 32)   | Firma del refresh token; en producción tiene que ser distinta de la anterior            |
| `JWT_ACCESS_TTL`               | `15m`                   | Vida del access token (`45s`, `15m`, `12h`, `30d`)                                      |
| `JWT_REFRESH_TTL`              | `30d`                   | Vida del refresh token                                                                  |
| `LOG_LEVEL`                    | `info`                  | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace`                            |
| `CORS_ORIGINS`                 | `http://localhost:5173` | Orígenes permitidos, separados por coma (se recortan espacios y vacíos)                 |
| `DB_POOL_MAX`                  | `5`                     | Conexiones máximas del pool a Postgres                                                  |
| `DB_STATEMENT_TIMEOUT_MS`      | — (apagado)             | Timeout de sentencia del lado del servidor. **No** usarlo con la URL pooled de Neon     |
| `AUTH_RATE_LIMIT_WINDOW_MS`    | `900000` (15 min)       | Ventana compartida de los límites de `/auth/*`                                          |
| `AUTH_RATE_LIMIT_MAX`          | `20`                    | Login: intentos **fallidos** por IP y ventana                                           |
| `AUTH_REGISTER_RATE_LIMIT_MAX` | `20`                    | Register: intentos por IP y ventana                                                     |
| `AUTH_REFRESH_RATE_LIMIT_MAX`  | `120`                   | Refresh: intentos por IP y ventana                                                      |
| `API_RATE_LIMIT_WINDOW_MS`     | `60000` (1 min)         | Ventana del límite global de `/api/v1`                                                  |
| `API_RATE_LIMIT_MAX`           | `300`                   | Requests por IP y ventana sobre `/api/v1`                                               |
| `ENABLE_SCHEDULER`             | `false`                 | Jobs en segundo plano. Debe ser `true` en **una sola** instancia                        |
| `STORAGE_PROVIDER`             | `local`                 | `local` (dev) \| `s3`. En producción tiene que ser `s3`                                 |
| `MAX_UPLOAD_BYTES`             | `10485760` (10 MB)      | Tamaño máximo de un adjunto                                                             |
| `UPLOAD_CONCURRENCY`           | `2`                     | Subidas simultáneas; cada una se bufferea entera en memoria. El exceso recibe `503`     |
| `LOCAL_STORAGE_SECRET`         | — (≥ 32)                | Obligatoria con `STORAGE_PROVIDER=local`; firma las URLs de descarga                    |
| `LOCAL_STORAGE_DIR`            | `./uploads`             | Carpeta de adjuntos en modo local                                                       |
| `S3_ENDPOINT`                  | —                       | Obligatoria con `s3` (R2: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`)              |
| `S3_REGION`                    | —                       | Obligatoria con `s3` (R2: `auto`)                                                       |
| `S3_BUCKET`                    | —                       | Obligatoria con `s3`                                                                    |
| `S3_ACCESS_KEY_ID`             | —                       | Obligatoria con `s3`                                                                    |
| `S3_SECRET_ACCESS_KEY`         | —                       | Obligatoria con `s3`                                                                    |
| `S3_FORCE_PATH_STYLE`          | `true`                  | Estilo de URL path-style (lo que esperan R2 y MinIO)                                    |

`POSTGRES_USER`, `POSTGRES_PASSWORD` y `POSTGRES_DB` solo las lee `docker-compose.yml`
para crear el Postgres local.

**Guard rails de producción.** Con `NODE_ENV=production` el proceso se niega a arrancar si
`STORAGE_PROVIDER` no es `s3` (el disco del contenedor es efímero), si `CORS_ORIGINS` no
incluye ningún origen que no sea localhost, o si los dos secretos JWT son iguales. Son
configuraciones que arrancan bien y fallan en silencio, así que se cortan en el boot.

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
│   ├── scheduler/          # runner genérico de jobs periódicos (sin solapamiento, con reintentos)
│   ├── health/             # /health (liveness) y /health/ready (readiness)
│   └── openapi/            # spec generada desde los schemas Zod
└── shared/                 # errors/ (+ catálogo de codes) · types/ · utils/ · testing/
prisma/                     # schema, migraciones y seed
scripts/bench/              # harness de benchmark para instancias mínimas (ver § Robustez y recursos)
openapi.yaml                # spec OpenAPI versionada, generada desde el código
docs/
├── SPECS.md                # spec técnico-funcional del producto
├── specs/                  # una spec por caso de uso
└── runbooks/               # restore-drill.md
```

Los módulos implementados son: `auth`, `users`, `households`, `invitations`, `categories`,
`currencies`, `expenses`, `settlements`, `balances`, `incomes`, `transfers`, `activity`,
`recurring-expenses`, `attachments`, `analytics` y `maintenance` (limpieza diaria de tablas
transitorias).

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
  [`error.middleware.ts`](src/app/middleware/error.middleware.ts), que además traduce las
  fallas de infraestructura: JSON malformado → `400`, body de más de 1 MB → `413`,
  violación de unicidad de Prisma (`P2002`) → `409`, registro inexistente (`P2025`) → `404` y
  base caída o con timeout → `503 SERVICE_UNAVAILABLE` con `Retry-After`. Una entrada
  hostil no debería terminar en `500`.
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
  devuelve un histórico sin acotar. El `cursor` es el id de una fila (UUID): uno que no lo
  sea es `422` (en `/activity`, cuyo cursor es opaco, es `400`).
- **Anulados**: los listados de gastos, settlements, transferencias e ingresos ocultan por
  defecto lo `voided`; `?includeVoided=true` lo incluye.
- **Validación compartida**: montos con hasta 12 dígitos enteros y 2 decimales; fechas
  civiles reales entre 1900 y 2100 (`2026-02-31` no pasa); como máximo 50 participantes
  distintos por gasto; textos con largo máximo y sin caracteres NUL; password de 8 a 72 bytes.
  Todo eso es `422 VALIDATION_ERROR`, nunca `500`.
- **Fechas**: las de negocio (`expenseDate`, `incomeDate`, `settlementDate`…) son **fechas
  civiles** `YYYY-MM-DD`, sin hora ni zona. Los timestamps de sistema (`createdAt`…) son
  ISO-8601 en UTC.
- **Trazabilidad**: cada respuesta lleva `X-Request-Id`. Se reusa el entrante solo si es
  seguro (hasta 128 caracteres de `A-Z a-z 0-9 . _ : -`); si no, se genera uno. Ese id aparece
  en los logs de Pino. CORS expone al navegador `Retry-After`, `Idempotency-Replayed`,
  `X-Request-Id` y los `RateLimit-*`.
- **Auth**: bearer token (`Authorization: Bearer <access>`, JWT con HS256 fijado); refresh con
  rotación atómica.
- **Autorización**: rutas household-scoped protegidas con `requireHouseholdMember(role?)`
  ([`authorization.middleware.ts`](src/app/middleware/authorization.middleware.ts)); valida
  membresía activa y, opcionalmente, rol `admin`. Carga `req.membership`.
- **Idempotencia**: header `Idempotency-Key` (1 a 255 caracteres ASCII imprimibles; conviene
  un UUID) **obligatorio** al crear gastos, settlements, incomes, transferencias y gastos
  recurrentes. La key se **reclama antes** de ejecutar el handler: si dos requests llegan a la
  vez con la misma key, uno corre y el otro recibe `409 IDEMPOTENCY_KEY_IN_PROGRESS` con
  `Retry-After`. Repetir la misma key con el mismo body devuelve la respuesta original (con
  `Idempotency-Replayed: true`) en vez de duplicar; con otro body, endpoint u hogar,
  `409 IDEMPOTENCY_KEY_CONFLICT`. Solo se guardan y repiten las respuestas `2xx`: un error
  libera la key para reintentar de verdad. Retención de 24 h
  ([`idempotency.middleware.ts`](src/app/middleware/idempotency.middleware.ts)).
- **Rate limiting** (por IP, store en memoria, `429 RATE_LIMITED`): `/auth/login` cuenta solo
  los intentos fallidos (`AUTH_RATE_LIMIT_MAX`); `/auth/register`
  (`AUTH_REGISTER_RATE_LIMIT_MAX`) y `/auth/refresh` (`AUTH_REFRESH_RATE_LIMIT_MAX`) tienen su
  propio presupuesto; y todo `/api/v1` tiene un tope global liviano (`API_RATE_LIMIT_MAX`).

### Endpoints (v1)

Base: `/api/v1`. Los marcados con 🔒 requieren `Authorization: Bearer <accessToken>`.

| Método | Ruta                                          | Descripción                                                                                  |
| ------ | --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| POST   | `/auth/register`                              | Crea usuario y devuelve `{ user, accessToken, refreshToken }`                                |
| POST   | `/auth/login`                                 | Login con email + password                                                                   |
| POST   | `/auth/refresh`                               | Rota el refresh token y devuelve un nuevo par                                                |
| POST   | `/auth/logout`                                | Revoca el refresh token recibido                                                             |
| POST   | `/auth/logout-all`                            | 🔒 Revoca todas las sesiones del usuario                                                     |
| GET    | `/users/me`                                   | 🔒 Perfil del usuario autenticado                                                            |
| PATCH  | `/users/me`                                   | 🔒 Actualiza `displayName` / `avatarUrl` / `preferredCurrencyCode`                           |
| GET    | `/users/me/invitations`                       | 🔒 Mis invitaciones pendientes (por email)                                                   |
| POST   | `/households`                                 | 🔒 Crea un hogar (el creador queda como `admin`)                                             |
| GET    | `/households`                                 | 🔒 Lista los hogares del usuario (con su rol y cantidad de miembros)                         |
| GET    | `/households/:id`                             | 🔒 Detalle del hogar (solo miembros)                                                         |
| PATCH  | `/households/:id`                             | 🔒 Actualiza el hogar (solo admin; moneda bloqueada con actividad)                           |
| DELETE | `/households/:id`                             | 🔒 Borra el hogar (soft delete, solo admin)                                                  |
| GET    | `/households/:id/members`                     | 🔒 Lista miembros activos (solo miembros)                                                    |
| PATCH  | `/households/:id/members/:userId`             | 🔒 Cambia el rol de un miembro (solo admin)                                                  |
| POST   | `/households/:id/members/leave`               | 🔒 Salir del hogar por cuenta propia (`204`)                                                 |
| DELETE | `/households/:id/members/:userId`             | 🔒 Quita un miembro (solo admin)                                                             |
| POST   | `/households/:id/invitations`                 | 🔒 Invita por email (solo admin)                                                             |
| GET    | `/households/:id/invitations`                 | 🔒 Invitaciones del hogar, todos los estados (solo admin)                                    |
| DELETE | `/households/:id/invitations/:id`             | 🔒 Revoca una invitación pendiente (solo admin)                                              |
| POST   | `/invitations/:token/accept`                  | 🔒 Acepta una invitación (solo el invitado)                                                  |
| POST   | `/invitations/:token/reject`                  | 🔒 Rechaza una invitación (solo el invitado)                                                 |
| GET    | `/categories`                                 | Catálogo global de categorías (de sistema)                                                   |
| GET    | `/households/:id/categories`                  | 🔒 Globales + propias del hogar                                                              |
| POST   | `/households/:id/categories`                  | 🔒 Crea una categoría propia (solo admin)                                                    |
| PATCH  | `/households/:id/categories/:id`              | 🔒 Edita una propia (solo admin)                                                             |
| DELETE | `/households/:id/categories/:id`              | 🔒 Elimina una propia (soft delete, solo admin)                                              |
| POST   | `/households/:id/expenses`                    | 🔒 Crea un gasto con sus splits (transaccional)                                              |
| GET    | `/households/:id/expenses`                    | 🔒 Lista paginada + filtros (`from,to,categoryId,paidBy,participantId,status,includeVoided`) |
| GET    | `/households/:id/expenses/:id`                | 🔒 Detalle con splits                                                                        |
| PATCH  | `/households/:id/expenses/:id`                | 🔒 Edita; cambiar el monto recalcula los splits                                              |
| DELETE | `/households/:id/expenses/:id`                | 🔒 Anula (`voided`), no borra                                                                |
| POST   | `/households/:id/expenses/:id/confirm`        | 🔒 Confirma una ocurrencia `pending` (pasa a `active`)                                       |
| POST   | `/households/:id/expenses/:id/skip`           | 🔒 Omite una ocurrencia `pending` (pasa a `voided`)                                          |
| GET    | `/households/:id/balances`                    | 🔒 Balance neto por miembro, derivado (nunca guardado); ex miembros solo si ≠ 0              |
| GET    | `/households/:id/balances/simplified`         | 🔒 Deudas simplificadas: quién le paga a quién                                               |
| POST   | `/households/:id/settlements`                 | 🔒 Registra un pago entre dos miembros (solo las partes)                                     |
| GET    | `/households/:id/settlements`                 | 🔒 Lista paginada (`?includeVoided=true` incluye los anulados)                               |
| GET    | `/households/:id/settlements/:id`             | 🔒 Detalle                                                                                   |
| DELETE | `/households/:id/settlements/:id`             | 🔒 Anula (`voided`); solo una de las partes o un admin                                       |
| POST   | `/households/:id/incomes`                     | 🔒 Registra un ingreso (no mueve balances)                                                   |
| GET    | `/households/:id/incomes`                     | 🔒 Lista paginada (`?includeVoided=true` incluye los anulados)                               |
| GET    | `/households/:id/incomes/:id`                 | 🔒 Detalle                                                                                   |
| PATCH  | `/households/:id/incomes/:id`                 | 🔒 Edita                                                                                     |
| DELETE | `/households/:id/incomes/:id`                 | 🔒 Anula (`voided`), no borra                                                                |
| POST   | `/households/:id/transfers`                   | 🔒 Registra una transferencia (no mueve balances, solo las partes)                           |
| GET    | `/households/:id/transfers`                   | 🔒 Lista paginada (`?includeVoided=true` incluye las anuladas)                               |
| GET    | `/households/:id/transfers/:id`               | 🔒 Detalle                                                                                   |
| DELETE | `/households/:id/transfers/:id`               | 🔒 Anula (`voided`); solo una de las partes o un admin                                       |
| GET    | `/households/:id/activity`                    | 🔒 Timeline unificado: gastos + ingresos + transferencias + settlements                      |
| POST   | `/households/:id/recurring-expenses`          | 🔒 Define un gasto recurrente (requiere `Idempotency-Key`)                                   |
| GET    | `/households/:id/recurring-expenses`          | 🔒 Lista                                                                                     |
| GET    | `/households/:id/recurring-expenses/upcoming` | 🔒 Próximos vencimientos y atrasados                                                         |
| PATCH  | `/households/:id/recurring-expenses/:id`      | 🔒 Edita / activa / desactiva                                                                |
| DELETE | `/households/:id/recurring-expenses/:id`      | 🔒 Elimina (soft delete)                                                                     |
| POST   | `/households/:id/expenses/:id/attachments`    | 🔒 Sube un comprobante (multipart, campo `file`)                                             |
| GET    | `/households/:id/expenses/:id/attachments`    | 🔒 Lista adjuntos                                                                            |
| GET    | `/.../attachments/:attId/download`            | 🔒 URL prefirmada de descarga (5 min)                                                        |
| DELETE | `/.../attachments/:attId`                     | 🔒 Elimina un adjunto                                                                        |
| GET    | `/households/:id/analytics/summary`           | 🔒 Total gastado, total ingresado, neto (`?from=&to=` obligatorio)                           |
| GET    | `/households/:id/analytics/by-category`       | 🔒 Gasto por categoría en el rango                                                           |
| GET    | `/households/:id/analytics/by-member`         | 🔒 Gasto por miembro (por su parte del split) en el rango                                    |
| GET    | `/households/:id/analytics/over-time`         | 🔒 Serie temporal (`?granularity=day\|week\|month`)                                          |
| GET    | `/households/:id/analytics/comparison`        | 🔒 Rango actual vs. el período anterior de igual duración                                    |
| GET    | `/currencies`                                 | Catálogo de monedas soportadas                                                               |

Las rutas `/households/:id/...` exigen ser miembro activo del hogar; las marcadas "solo
admin" exigen además el rol `admin`. Los `POST` de gastos, settlements, incomes,
transferencias y gastos recurrentes requieren `Idempotency-Key` (ver
[Convenciones de la API](#convenciones-de-la-api)).

**Tokens:** el **access** es un JWT corto (15m). El **refresh** es un string opaco (30d) del
que solo se guarda su hash; en cada `/auth/refresh` se rota **de forma atómica** y, si se
reutiliza uno ya revocado, se revocan todas las sesiones (defensa ante robo de token). Ojo: si
dos refresh del mismo token corren en paralelo, el que pierde la carrera cuenta como
reutilización y **cierra todas las sesiones**, así que los clientes deben serializarlos.

**Balances con ex miembros:** quien salió del hogar solo aparece en `/balances` y
`/balances/simplified` mientras su neto sea distinto de cero, marcado con `isFormerMember`
(`fromIsFormerMember` / `toIsFormerMember` en las deudas simplificadas).

### Catálogo de errores

Los códigos son **estables** y forman parte del contrato: el cliente renderiza texto a partir
del `code`, nunca del `message` (que está en inglés y es para debug). La lista canónica vive en
[`src/shared/errors/codes.ts`](src/shared/errors/codes.ts).

| Código                             | HTTP  | Cuándo                                                                                                     |
| ---------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| `BAD_REQUEST`                      | `400` | Request malformado: JSON inválido, `Idempotency-Key` ausente o mal formada, cursor de `/activity` inválido |
| `UNAUTHORIZED`                     | `401` | Token ausente, inválido o vencido                                                                          |
| `INVALID_CREDENTIALS`              | `401` | Email o password incorrectos                                                                               |
| `TOKEN_REUSE_DETECTED`             | `401` | Se reusó un refresh revocado → se cierran todas las sesiones                                               |
| `FORBIDDEN`                        | `403` | Autenticado pero sin permiso (p. ej. anular un settlement ajeno)                                           |
| `NOT_A_MEMBER`                     | `403` | No es miembro activo del hogar                                                                             |
| `INSUFFICIENT_ROLE`                | `403` | La acción requiere rol `admin`                                                                             |
| `NOT_FOUND`                        | `404` | Recurso o ruta inexistente                                                                                 |
| `HOUSEHOLD_NOT_FOUND`              | `404` | El hogar no existe o está archivado                                                                        |
| `INVITATION_NOT_FOUND`             | `404` | Token de invitación inexistente                                                                            |
| `CONFLICT`                         | `409` | Conflicto de negocio genérico                                                                              |
| `EMAIL_ALREADY_REGISTERED`         | `409` | Ya existe una cuenta con ese email                                                                         |
| `USERNAME_TAKEN`                   | `409` | Ya existe una cuenta con ese username                                                                      |
| `LAST_ADMIN`                       | `409` | Dejaría al hogar sin administradores                                                                       |
| `MEMBER_HAS_OPEN_BALANCE`          | `409` | Salir del hogar, o que un admin lo quite, con balance ≠ 0                                                  |
| `HOUSEHOLD_CURRENCY_LOCKED`        | `409` | Cambiar la moneda de un hogar que ya tiene actividad financiera                                            |
| `INVITATION_EXPIRED`               | `409` | Venció el TTL de 7 días                                                                                    |
| `INVITATION_ALREADY_RESOLVED`      | `409` | Ya fue aceptada o rechazada                                                                                |
| `INVITATION_ALREADY_PENDING`       | `409` | Ya hay una invitación abierta para ese email                                                               |
| `ALREADY_MEMBER`                   | `409` | Esa persona ya pertenece al hogar                                                                          |
| `EXPENSE_ALREADY_VOIDED`           | `409` | El gasto ya estaba anulado                                                                                 |
| `SETTLEMENT_ALREADY_VOIDED`        | `409` | El settlement ya estaba anulado                                                                            |
| `INCOME_ALREADY_VOIDED`            | `409` | El ingreso ya estaba anulado                                                                               |
| `TRANSFER_ALREADY_VOIDED`          | `409` | La transferencia ya estaba anulada                                                                         |
| `RECURRING_OCCURRENCE_NOT_PENDING` | `409` | Confirmar/omitir un gasto que no está `pending`                                                            |
| `IDEMPOTENCY_KEY_CONFLICT`         | `409` | Misma `Idempotency-Key` con otro body, endpoint u hogar                                                    |
| `IDEMPOTENCY_KEY_IN_PROGRESS`      | `409` | Hay otro request con esa key en curso (`Retry-After`)                                                      |
| `PAYLOAD_TOO_LARGE`                | `413` | El body JSON supera 1 MB                                                                                   |
| `ATTACHMENT_TOO_LARGE`             | `413` | Supera `MAX_UPLOAD_BYTES` (10 MB por defecto)                                                              |
| `UNSUPPORTED_MEDIA_TYPE`           | `415` | Los magic bytes no son JPEG, PNG, WEBP ni PDF                                                              |
| `VALIDATION_ERROR`                 | `422` | El body/params/query no pasó el schema Zod (`details` por campo)                                           |
| `INVALID_PAYER`                    | `422` | El pagador no es miembro activo (`409` al confirmar un `pending`)                                          |
| `INVALID_PARTICIPANT`              | `422` | Algún participante no es miembro activo (`409` al confirmar un `pending`)                                  |
| `INVALID_EXPENSE_SPLIT`            | `422` | Los splits no suman el total, o los porcentajes no dan 100                                                 |
| `INVALID_CATEGORY`                 | `422` | La categoría no es global ni del hogar                                                                     |
| `INVALID_CURRENCY`                 | `422` | No es la moneda del hogar                                                                                  |
| `INVALID_SETTLEMENT`               | `422` | `from == to`, monto ≤ 0, o alguien no es miembro                                                           |
| `INVALID_TRANSFER`                 | `422` | `from == to`, monto ≤ 0, o alguien no es miembro                                                           |
| `TOO_MANY_ATTACHMENTS`             | `422` | Ya hay 5 adjuntos en ese gasto                                                                             |
| `RATE_LIMITED`                     | `429` | Demasiados intentos en `/auth/*`                                                                           |
| `INTERNAL_ERROR`                   | `500` | Falla inesperada (no filtra detalles al cliente)                                                           |
| `SERVICE_UNAVAILABLE`              | `503` | Base de datos caída o con timeout (`Retry-After`)                                                          |
| `UPLOAD_CAPACITY_EXCEEDED`         | `503` | Hay demasiadas subidas en curso (`Retry-After`)                                                            |

### Reglas de negocio que conviene tener presentes

- **Nada se borra**: `DELETE` anula (`voided`). Los anulados no cuentan en balances ni analytics.
- **Los balances son derivados**, nunca un campo guardado: `Σ(balances) == 0` siempre.
- **Ingresos y transferencias no mueven balances** entre miembros; solo alimentan analytics.
- **Un hogar = una moneda** (`defaultCurrencyCode`). No hay conversión en el MVP.
- **Un hogar nunca queda sin admin**: no se puede quitar ni degradar al último.
- Un **settlement** o una **transferencia** solo los registra alguien que sea parte, y solo una
  de las partes o un admin puede anularlos (`403 FORBIDDEN` si no).
- **Salir de un hogar** (`POST .../members/leave`) o que un admin quite a alguien exige balance
  neto cero: si no, `409 MEMBER_HAS_OPEN_BALANCE`. El último admin no puede salir ni ser
  degradado (`409 LAST_ADMIN`).
- La **moneda del hogar** se bloquea en cuanto hay actividad financiera (gastos, settlements,
  ingresos, transferencias o plantillas recurrentes, anulados incluidos):
  `409 HOUSEHOLD_CURRENCY_LOCKED`.
- Una **invitación** vencida pasa a `expired` y se puede volver a invitar al mismo email.
- El `PATCH` de un gasto recalcula el split de cero: `amount`, `splitType` y `participants`
  van los tres juntos o ninguno.
- Los gastos generados por un recurrente nacen en `pending` y hay que confirmarlos u omitirlos.
  Confirmar uno cuyo pagador o participante ya salió del hogar es `409` (`INVALID_PAYER` /
  `INVALID_PARTICIPANT`).

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
entre otras cosas sube los límites de `/auth/*`, porque solo armar los fixtures de un archivo
ya hace decenas de llamadas reales a `/auth`.

La suite tiene más de 350 tests (unitarios + integración). Los bugs de concurrencia y de
borde se atacaron **reproduciéndolos primero** con un test que fallaba (carreras de refresh,
de claim de idempotencia, de salida de miembros), y recién después se corrigieron.

## Flujo de ramas y entornos

Modelo por entorno:

| Rama                | Rol                 | ¿Desplegada?                                             |
| ------------------- | ------------------- | -------------------------------------------------------- |
| `develop` (default) | integración         | No — corre local y en CI                                 |
| `staging`           | pre-producción / QA | No — corre local y en CI                                 |
| `main`              | **producción**      | Será el único entorno desplegado (todavía no hay deploy) |

Cuando se despliegue, solo `main` va a estar en el aire: es un proyecto personal y un entorno
desplegado alcanza. El CI cubre lo que daría un staging —migraciones, seed y toda la suite
contra un Postgres desechable— en cada PR a las tres ramas.

- Trabajo en ramas cortas: `feature/*`, `fix/*`, `chore/*` desde `develop`.
- Promoción vía PR: `feature/*` → `develop` → `staging` → `main`.
- **Hotfix**: rama desde `main`, PR a `main`, y back-merge a `staging` y `develop`.
- `main`/`staging`/`develop` protegidas: PR obligatorio + CI en verde.
- Mensajes de commit en formato **Conventional Commits** (`feat:`, `fix:`, `chore:`…).

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) corre en cada push/PR a esas tres
ramas: `install → format:check → lint → typecheck → migrate deploy → seed → test → build`, contra un
Postgres desechable (servicio de GitHub Actions). Además verifica que `openapi.yaml` no esté
desactualizado respecto del código (ver [OpenAPI](#openapi)).

## Deploy

**Todavía no hay nada desplegado.** El plan es un solo entorno —**producción**, desde
`main`— sobre servicios gratuitos. `develop` y `staging` viven en tu máquina y en el CI, que
ya corre migraciones, seed y toda la suite contra un Postgres desechable en cada PR.

| Pieza    | Servicio                             | Por qué                                                            |
| -------- | ------------------------------------ | ------------------------------------------------------------------ |
| API      | Render Free, Docker, rama `main`     | 750 h/mes por workspace; se suspende tras 15 min sin tráfico       |
| Base     | [Neon](https://neon.com) Free        | El Postgres Free de Render **expira a los 30 días**; el de Neon no |
| Adjuntos | [Cloudflare R2](https://r2.dev) Free | 10 GB y sin cargos de egress; S3-compatible, sin cambios de código |

[`render.yaml`](render.yaml) declara ese único servicio. La base y el almacenamiento son
externos, así que sus credenciales se cargan a mano en el dashboard (`sync: false`) y nunca
se commitean: `DATABASE_URL` (la URL **pooled** de Neon), `CORS_ORIGINS`, `S3_ENDPOINT`,
`S3_BUCKET`, `S3_ACCESS_KEY_ID` y `S3_SECRET_ACCESS_KEY`. Los secretos JWT los genera Render.

Con `NODE_ENV=production` rigen los [guard rails](#variables-de-entorno): si `CORS_ORIGINS`
sigue en localhost, si el storage no es `s3` o si los secretos JWT coinciden, el servicio no
arranca.

La imagen ([`Dockerfile`](Dockerfile)) es multi-stage, corre como usuario `node` bajo `tini`
(PID 1: reenvía `SIGTERM` para que el shutdown ordenado ocurra y recoge zombies), fija
`NODE_OPTIONS=--max-old-space-size=320` para dejar margen dentro de 512 MB y **no** trae la CLI
de Prisma ni `prisma/` (las migraciones se corren a mano) ni un `HEALTHCHECK` (Render usa
`healthCheckPath`). La build excluye los tests (`tsconfig.build.json`) y `prisma` es una
`devDependency`.

### Migraciones

El pre-deploy command de Render es **solo para planes pagos**, así que las migraciones se
corren a mano, contra la connection string **directa** de Neon (la que _no_ lleva `-pooler`;
Prisma puede fallar a través de PgBouncer):

```bash
DATABASE_URL="<neon-direct-url>" npx prisma migrate deploy
DATABASE_URL="<neon-direct-url>" npx prisma db seed   # solo la primera vez
```

Sin el seed, `currencies` queda vacía y **todo registro de usuario falla** por la foreign key
de `preferred_currency_code`.

Las migraciones tienen que ser **compatibles hacia atrás**: entre que se aplican y sube la
versión nueva, el código viejo sigue sirviendo. Un cambio destructivo va en dos deploys.

### Detalles operativos

- **Health Check Path**: `/health` (liveness, no toca la base). Es a propósito: Render lo
  consulta todo el tiempo, y un `SELECT 1` en cada sondeo mantendría despierto a Neon (se
  comería sus CU-horas gratis) y haría que Render reinicie un proceso sano por un hipo de la
  base. `/health/ready` queda para chequear a mano o desde un monitor externo.
- **Scheduler**: `ENABLE_SCHEDULER=true` funciona aunque el servicio duerma —
  [`startInterval`](src/infrastructure/scheduler/scheduler.ts) ejecuta el job al arrancar, y
  `generateDueOccurrences` es idempotente y recupera los días perdidos. Las ocurrencias se
  generan en cada wake-up en vez de por reloj.
- **Backups**: los del plan de Neon. El procedimiento de restauración, ejercitado solo en
  local, está en [`docs/runbooks/restore-drill.md`](docs/runbooks/restore-drill.md); falta
  repetirlo contra Neon antes de salir a producción.
- **Primer request tras inactividad**: ~1 minuto, por el spin-down del plan Free. Pasar a
  Starter es un dropdown en el dashboard, sin migración ni downtime.

## Robustez y recursos

Pensado para correr en una instancia mínima (Render Free: ~512 MB y una fracción de CPU)
detrás del pgbouncer de Neon:

- **Proceso**: handlers de `unhandledRejection` (loguea) y `uncaughtException` (loguea y sale
  para que la plataforma levante uno limpio); shutdown ordenado ante `SIGTERM`/`SIGINT` con
  tope duro de 10 s; `keepAliveTimeout` 65 s, `headersTimeout` 66 s y `requestTimeout` 120 s.
- **Base**: pool acotado (`DB_POOL_MAX=5`), timeout de conexión 10 s, conexiones ociosas
  cerradas a los 30 s y `query_timeout` de 20 s en el cliente. El `statement_timeout` del
  servidor es opt-in (`DB_STATEMENT_TIMEOUT_MS`) porque el pgbouncer de Neon rechaza los
  parámetros de arranque que no conoce.
- **Memoria**: heap acotado en la imagen, uploads limitados a 1 archivo y `UPLOAD_CONCURRENCY`
  simultáneos, AWS SDK cargado perezosamente y con timeouts, blobs huérfanos limpiados si
  falla el insert.
- **Datos**: los balances se calculan con **una** agregación SQL en vez de cargar el
  historial; analytics por miembro agrupa en SQL; los listados nunca devuelven histórico sin
  acotar; no se cargan `passwordHash` ni columnas que no se devuelven.
- **Concurrencia**: salir de un hogar, quitar miembros, cambiar roles o la moneda toman un
  lock de fila sobre el hogar (`FOR UPDATE`); las escrituras dependientes toman `FOR SHARE`.
  Anular, confirmar, omitir y editar son atómicos; el refresh rota de forma atómica; el
  registro resuelve la carrera con un `409`.
- **Scheduler** (`ENABLE_SCHEDULER=true`, una sola instancia): sin solapamiento de corridas,
  reintentos con backoff (30 s, 2 min, 10 min), generación de recurrentes acotada (hasta 62
  ocurrencias por plantilla por corrida; una plantilla pasada su `endDate` se desactiva) y un
  job de mantenimiento diario que purga las `idempotency_keys` de más de 24 h y los refresh
  tokens vencidos o revocados hace más de 7 días.
- **Logs**: Pino redacta `Authorization`, cookies, passwords y tokens; el log de request es
  mínimo (método, URL sin query ni token de invitación, status); `/health*` no se loguea.
- **Benchmark**: [`scripts/bench`](scripts/bench/README.md) siembra una base y mide boot,
  memoria y latencia de una imagen Docker con `--memory=512m --cpus=0.1`
  (`npx tsx scripts/bench/seed.ts --reset`, luego
  `npx tsx scripts/bench/run.ts --image <tag> --memory 512m --cpus 0.1`).
  (ver resultados del benchmark)

## OpenAPI

La spec vive versionada en [`openapi.yaml`](openapi.yaml) en la raíz y se **genera desde el
código** (`npm run openapi:export`), no se edita a mano. El CI falla si quedó desactualizada
(`npm run openapi:check`), y un contract test valida las respuestas reales contra sus
schemas. Swagger UI en `/docs` y el JSON crudo en `/docs/openapi.json`.

## Estado

El **MVP está completo** según la Definition of Done de [`docs/SPECS.md`](docs/SPECS.md) §41:

| Fase                                                      | Estado       |
| --------------------------------------------------------- | ------------ |
| Cimientos (TS, Express, Prisma, config, logging, errores) | ✅           |
| Autenticación y usuarios                                  | ✅           |
| Hogares, membresía e invitaciones                         | ✅           |
| Categorías                                                | ✅           |
| Gastos y las 4 estrategias de división                    | ✅           |
| Balances derivados y settlements                          | ✅           |
| Ingresos, transferencias y timeline unificado             | ✅           |
| Gastos recurrentes + job de generación                    | ✅           |
| Adjuntos con abstracción de storage                       | ✅           |
| Analytics                                                 | ✅           |
| Idempotencia, rate limiting, OpenAPI, CI/CD, Docker       | ✅           |
| Presupuestos y metas de ahorro                            | ⬜ post-MVP  |
| Hardening para instancia mínima (ver Robustez)            | ✅           |
| **Deploy a producción**                                   | ⬜ pendiente |

El código está listo para desplegarse; falta la infraestructura (cuentas de Neon, R2 y
Render) y correr el plan de deploy. Ver **Deploy** más arriba.

Pendientes conocidos, con su ticket implícito:

- **Sin envío de emails**: la invitación devuelve el `token` y el link se comparte a mano.
  Tampoco hay verificación de email ni recuperación de contraseña.
- **Sin multi-moneda real**: la tabla `exchange_rates` existe pero no se usa.
- Los rate limiters usan un **store en memoria**: sirven mientras la app corra en una sola
  instancia. Escalar horizontalmente requiere un store compartido (y el scheduler, un solo
  responsable).
- **Sin monitoreo de errores**: no hay Sentry ni equivalente integrado — no existe la
  dependencia, ni código que la use, ni validación en `config.ts`. Hoy un `500` en
  producción solo deja rastro en los logs de Pino.
