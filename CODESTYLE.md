# Code Style — Vaquitapp

Convenciones de código del backend. Cortas, concretas y —donde se puede— **verificadas por
la máquina**, no por memoria.

La regla general: **si una convención se puede automatizar, se automatiza**. Lo que queda en
este documento es lo que requiere criterio.

| Regla                       | Quién la hace cumplir                          |
| --------------------------- | ---------------------------------------------- |
| Formato                     | Prettier (hook `pre-commit`)                   |
| Lint                        | ESLint (hook `pre-commit`, `--max-warnings 0`) |
| Tipos                       | `tsc --noEmit` (CI)                            |
| Formato del commit          | commitlint (hook `commit-msg`)                 |
| Pureza de `domain/`         | ESLint `no-restricted-imports`                 |
| Nada de floats en dinero    | ESLint `no-restricted-globals`                 |
| Promesas sueltas            | ESLint `no-floating-promises` (type-aware)     |
| Idioma, comentarios, diseño | Revisión de PR                                 |

---

## 1. Idioma: todo en inglés

**El código se escribe en inglés.** Identificadores, comentarios, JSDoc, mensajes de error y
mensajes de commit.

El español queda para: la UI del cliente, el README, y los apuntes personales.

```ts
// ✅
/** Distributes `total` across participants using the largest remainder method. */
export const allocate = (total: DecimalValue, weights: DecimalValue[]): Decimal[] => { ... };

throw new BadRequestError(`Unsupported currency: ${code}`);

// ❌
/** Reparte `total` entre los participantes por el método del mayor resto. */
throw new BadRequestError(`Moneda no soportada: ${code}`);
```

**Sobre los mensajes de error**: el contrato con el cliente es el **`code`**, que es estable y
está documentado. El `message` es para quien debuggea. El cliente renderiza texto a partir del
`code`, nunca del `message` — así el día que haya i18n no hay que tocar el backend.

```json
{ "error": { "code": "INVALID_CURRENCY", "message": "Unsupported currency: XYZ" } }
```

**Migración**: no se traduce todo de golpe. **El código que tocás, lo dejás en inglés.** Si
editás una función con comentarios en español, los traducís en ese mismo commit. Nada de PRs
de "traducir todo" mezclados con cambios de lógica.

---

## 2. Commits

**Conventional Commits, en inglés, en imperativo.** Lo valida commitlint en el hook
`commit-msg`: un mensaje mal formado **no commitea**.

```
type(scope): subject

body opcional

footer opcional
```

```bash
# ✅
feat(expenses): add percentage split strategy
fix(auth): reject refresh tokens after rotation
refactor(domain): move allocate out of utils
test(balances): cover zero-sum invariant
docs(readme): document settlement endpoints

# ❌
Arreglé el bug de los splits        → no es inglés, no tiene type
feat: Add split strategies.         → subject capitalizado y con punto final
update stuff                        → no dice nada
feat(Expenses): add split           → el scope va en kebab-case
```

Reglas que aplica la herramienta:

- **type** obligatorio, uno de: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`,
  `ci`, `style`, `revert`, `chore`.
- **scope** opcional, en `kebab-case`, normalmente el módulo (`expenses`, `auth`, `households`).
- **subject** en minúscula, sin punto final, en **imperativo** (`add`, no `added`/`adds`).
- **header** ≤ 72 caracteres. Líneas del body ≤ 100.

`chore` es el último recurso. Si podés decir `refactor`, `build` o `docs`, usá ese.

**Un commit = un cambio con sentido.** Si el mensaje necesita un "y", probablemente sean dos
commits. El body explica **por qué**, no qué (el diff ya dice qué).

---

## 3. Formato y lint: no se discuten

Prettier y ESLint corren solos en cada commit sobre los archivos staged (`lint-staged`).
No hay estilo personal que negociar: el que decide es el formateador.

```bash
npm run format        # aplica Prettier
npm run format:check  # verifica sin escribir (esto corre en CI)
npm run lint          # ESLint
npm run lint:fix      # ESLint con autofix
npm run typecheck     # tsc --noEmit
```

**Los warnings de ESLint son errores**: el hook corre con `--max-warnings 0`. Si aparece un
warning, se arregla, no se acumula.

**Nunca uses `--no-verify`.** Si el hook te bloquea, el hook tiene razón. Si de verdad no la
tiene, se arregla la regla en `eslint.config.js` y se discute en el PR — no se saltea.

**`eslint-disable` requiere justificación.** Una línea, no un archivo, y con el motivo:

```ts
// ✅
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma's JsonValue is not exportable
const payload = raw as any;

// ❌
/* eslint-disable */
```

---

## 4. Código depurable

Cuando algo falle en producción a las 3 AM, el log tiene que alcanzar para entender qué pasó.
Eso se diseña, no se improvisa.

### 4.1 Los errores llevan contexto

Usá las clases de [`src/utils/errors.ts`](src/utils/errors.ts). Cada error tiene `code`
estable, `statusCode` y `details` opcionales. Nunca tires un string.

```ts
// ✅ el code es buscable, los details dicen qué pasó exactamente
throw new ValidationError('Participants do not sum to the expense total', {
  expected: total.toFixed(2),
  received: sum.toFixed(2),
  expenseId,
});

// ❌ no tiene stack, no tiene code, no se puede filtrar en el log
throw 'invalid split';

// ❌ el mensaje no dice cuál era el valor
throw new ValidationError('Invalid amount');
```

### 4.2 Nunca te comas un error

```ts
// ❌ el error desaparece y el bug tarda una semana en aparecer
try {
  await doSomething();
} catch {
  return null;
}

// ✅ si lo capturás, es porque tenés algo que decir
try {
  await doSomething();
} catch (error: unknown) {
  logger.warn({ error, expenseId }, 'attachment cleanup failed, expense was created');
  // se sigue: el gasto ya está persistido y el adjunto se reintenta después
}
```

### 4.3 Logging estructurado, no `console`

`no-console` es un error de ESLint en todo `src/`. Los logs van por **pino**, con objeto de
contexto primero y mensaje después, así se pueden filtrar por campo.

```ts
// ✅
logger.info({ userId, householdId, expenseId, operation: 'expense.create' }, 'expense created');

// ❌ no se puede filtrar, no se puede agrupar
console.log('Gasto creado ' + expenseId);
```

Las únicas excepciones —y están declaradas en `eslint.config.js`— son
[`src/config/env.ts`](src/config/env.ts) (falla antes de que exista el logger) y
[`src/server.ts`](src/server.ts) (arranque y apagado). Los scripts de `prisma/` tampoco son
código de aplicación.

**Nunca loguees**: passwords, tokens (access o refresh), hashes, ni contenido de comprobantes.

### 4.4 Nada de promesas sueltas

Una promesa sin `await` falla en silencio y deja el request colgado. ESLint lo detecta con
reglas type-aware.

```ts
// ❌ si falla, es un unhandledRejection que tumba el proceso
prisma.expense.create({ data });

// ✅
await prisma.expense.create({ data });

// ✅ intencionalmente fire-and-forget: se marca explícito y se maneja el rechazo
void sendInvitationEmail(email).catch((error: unknown) => {
  logger.error({ error, email }, 'invitation email failed');
});
```

Todo handler async de Express va envuelto en
[`asyncHandler`](src/utils/asyncHandler.ts). Si no, Express 5 se traga el rechazo y el cliente
espera para siempre.

### 4.5 La lógica financiera es pura

Splits, balances y neteo viven en `src/domain/` y **no importan Express ni Prisma** (lo
bloquea ESLint). Una función pura se debuggea con un test de tres líneas; una que necesita
levantar Postgres, no.

```ts
// ✅ testeable sin base ni servidor
export const calculateBalances = (activity: FinancialActivity[]): Balance[] => { ... };

// ❌ para probar un redondeo hay que levantar media aplicación
export const calculateBalances = async (householdId: string): Promise<Balance[]> => {
  const expenses = await prisma.expense.findMany(...);
};
```

### 4.6 Fallar temprano y fuerte

La validación pasa **antes** de la lógica de negocio (Zod en `validate.middleware`). La config
se valida al arrancar: si falta una variable de entorno, el proceso **no levanta** —
mejor un crash al deploy que un `undefined` en producción tres días después.

---

## 5. Comentarios

**Regla: el comentario explica el _por qué_. El código explica el _qué_.**

Si necesitás un comentario para entender _qué_ hace una línea, el problema es el nombre de la
variable o de la función, no la falta de comentario.

```ts
// ❌ redundante: repite el código
// Suma los montos
const total = sumDecimals(amounts);

// ❌ vago y sin valor
// Acá hacemos la magia
const result = allocate(total, weights);

// ✅ explica una decisión que el código no puede expresar
// Se trabaja en unidades mínimas enteras (centavos) para que el reparto del
// sobrante sea exacto: en decimales, el redondeo se acumularía.
const totalUnits = totalDec.times(factor).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

// ✅ explica un no-obvio del entorno
// `process.exit()` nunca dispara `beforeExit`, así que el disconnect va acá.
await prisma.$disconnect();
```

Comentarios que **sí** valen la pena:

- una decisión de negocio o de dominio que no se lee en el código;
- un workaround y su motivo (con link al issue si existe);
- una invariante que el tipo no puede expresar;
- por qué **no** se hizo lo obvio.

Comentarios que **no** van:

- traducir el código a prosa;
- separadores decorativos dentro de una función;
- **código comentado** — para eso está git;
- `TODO` sin dueño ni contexto. Si es importante, es un issue; si no, no va.

**JSDoc** solo en lo público y no obvio: funciones de dominio, utilidades compartidas,
middlewares. Con `@param` y `@returns` cuando aportan; no repitas los tipos, que ya están en
la firma.

---

## 6. Estructura de la codebase

### 6.1 Anatomía de un módulo

Un módulo por dominio, siempre los mismos archivos y las mismas responsabilidades:

```
src/modules/expenses/
├── expenses.routes.ts      # rutas + composición de middlewares. Cero lógica.
├── expenses.controller.ts  # lee el request, llama al service, mapea la respuesta. Fino.
├── expenses.service.ts     # el caso de uso: autorización, transacción, orquestación.
├── expenses.schema.ts      # schemas Zod + los tipos que infiere.
├── expenses.mapper.ts      # entidad de Prisma → DTO de la API.
└── expenses.test.ts        # tests del módulo.
```

### 6.2 Reglas de capa

| Capa         | Puede importar                    | **No** puede importar                 |
| ------------ | --------------------------------- | ------------------------------------- |
| `routes`     | controller, middlewares, schema   | prisma, service                       |
| `controller` | service, mapper, schema           | **prisma**                            |
| `service`    | prisma, domain, otros services    | express (`Request`/`Response`)        |
| `mapper`     | tipos, utils                      | prisma client, service                |
| `domain/`    | nada del proyecto salvo `domain/` | **express, prisma** (lo corta ESLint) |

Las dos que más se rompen y hay que mirar en cada PR:

- **Un controller nunca toca Prisma.** Si lo hace, la lógica se está escapando de la capa
  donde se puede testear.
- **Un service nunca ve `req` ni `res`.** Recibe datos ya validados y devuelve datos, no HTTP.

```ts
// ✅ el controller traduce HTTP y nada más
export const createExpense = asyncHandler(async (req, res) => {
  const householdId = routeParam(req, 'householdId');
  const expense = await expensesService.createExpense(req.user.id, householdId, req.body);
  res.status(201).json(expense);
});

// ❌ el controller hace de service
export const createExpense = asyncHandler(async (req, res) => {
  const member = await prisma.householdMember.findFirst({ ... });
  if (!member) return res.status(403).json({ ... });
  ...
});
```

### 6.3 Nombres

- Archivos: `kebab-case`, con sufijo de rol (`expenses.service.ts`, `auth.middleware.ts`).
- Tipos, clases e interfaces: `PascalCase`. DTOs con sufijo: `CreateExpenseDto`, `ExpenseDto`.
- Funciones y variables: `camelCase`. Constantes de módulo: `UPPER_SNAKE_CASE`.
- Booleanos con prefijo: `isActive`, `hasOpenBalance`, `canEdit`.
- Funciones que lanzan si no se cumple algo: `assertX` (`assertCurrencyExists`).
- Nada de abreviaturas crípticas: `membership`, no `mbsp`. `index`, no `i`, salvo en un loop corto.

### 6.4 Módulos y exports

- **ESM con extensión `.js` en los imports** (`import { prisma } from '../config/prisma.js'`).
  Es `NodeNext`: sin la extensión, no resuelve en runtime.
- **Named exports.** Nada de `export default` salvo que una herramienta lo pida
  (`eslint.config.js`, `commitlint.config.js`).
- No hay `index.ts` de barril: importá del archivo concreto. Los barriles esconden ciclos.

### 6.5 Tipos

- `strict` y `noUncheckedIndexedAccess` están activos. Indexar un array te devuelve
  `T | undefined` **a propósito**: manejalo o afirmá con `!` sabiendo por qué.
- `any` es un warning y hay que justificarlo. Para lo desconocido, `unknown` + validación Zod.
- Tipos explícitos en los **bordes** (params y retorno de funciones exportadas). Adentro, dejá
  inferir.
- Los tipos de request/response se derivan de los schemas Zod (`z.infer`), no se escriben dos veces.

---

## 7. Dinero

La regla que no se rompe nunca: **cero punto flotante en cálculos monetarios.**

- En la base: `numeric(14,2)`.
- En el código: `Decimal` (decimal.js). `parseFloat` está prohibido por ESLint.
- En JSON: **string** (`"85000.00"`), nunca `number`.
- Al repartir: [`allocate`](src/utils/money.ts), que garantiza `Σ(partes) == total`.
- Los decimales salen de la moneda (`Currency.decimalPlaces`), no de un `2` hardcodeado.

```ts
// ❌ pierde centavos en silencio
const share = expense.amount / participants.length;

// ✅ la suma cierra exacto, siempre
const shares = allocate(
  expense.amount,
  participants.map(() => 1),
  currency.decimalPlaces,
);
```

Toda mutación financiera es **transaccional** (`prisma.$transaction`). Un gasto y sus splits se
persisten o todo o nada.

---

## 8. Tests

- La lógica de dominio se testea **sin base y sin HTTP**. Si necesitás Postgres para probar un
  redondeo, la capa está mal cortada.
- Las invariantes financieras son tests explícitos, no comentarios:
  `Σ(splits) == amount`, `Σ(balances) == 0`.
- Nombres de test en inglés y descriptivos: qué hace y bajo qué condición.
- Casos borde obligatorios en dinero: montos que no dividen exacto (100/3), un solo
  participante, monedas de 0 decimales.

```ts
describe('allocate', () => {
  it('distributes the remainder so the parts sum exactly to the total', () => { ... });
});
```

---

## 9. Antes de abrir un PR

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
```

Y a ojo, lo que la máquina no ve:

- [ ] ¿Los nombres dicen lo que hacen?
- [ ] ¿Hay comentarios que sobran, o falta alguno que explique un _por qué_?
- [ ] ¿El controller quedó fino? ¿El service no toca HTTP?
- [ ] ¿Todo monto es `Decimal` y viaja como string?
- [ ] ¿Las rutas household-scoped validan membresía?
- [ ] ¿Los errores nuevos tienen un `code` estable y documentado?
- [ ] ¿Los cambios importantes están reflejados en el README?
- [ ] ¿Quedó código comentado, `console.log` de debug o un `TODO` huérfano?

---

## 10. Configuración de referencia

| Archivo                                        | Qué define                                   |
| ---------------------------------------------- | -------------------------------------------- |
| [`.prettierrc.json`](.prettierrc.json)         | Formato: comillas simples, 100 cols, semis   |
| [`eslint.config.js`](eslint.config.js)         | Lint, reglas type-aware y pureza del dominio |
| [`commitlint.config.js`](commitlint.config.js) | Formato de los mensajes de commit            |
| [`tsconfig.json`](tsconfig.json)               | `strict` + `noUncheckedIndexedAccess`        |
| `.husky/pre-commit`                            | `lint-staged` sobre los archivos staged      |
| `.husky/commit-msg`                            | `commitlint`                                 |
| `package.json` → `lint-staged`                 | Qué corre sobre cada tipo de archivo         |

Después de un `git clone`, `npm install` deja los hooks instalados solo (script `prepare`).
