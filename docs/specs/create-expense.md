# Use Case: Create Expense

Feature: Create Expense

Goal: Record a shared or personal expense in a household and split it among
participants using one of the four supported strategies.

Actors: Authenticated household member.

Preconditions: The requesting user is an active member of the household.

## Input

- `householdId` (route)
- `description`, `amount`, `currencyCode`, `expenseDate`, `categoryId?`
- `paidBy` (userId)
- `splitType`: `equal` | `exact` | `percentage` | `shares`
- `participants[]`: `{ userId, amount? | percentage? | shares? }` depending on `splitType`
- `Idempotency-Key` header (required)

## Output

`ExpenseDto` with `status: active` and its `splits[]`.

## Business rules

- The payer and **every** participant must be active members of the household —
  never trust the client-provided ids without checking membership.
- `categoryId`, if present, must resolve to a global category (`isSystem`) or one
  owned by this household.
- `currencyCode` must equal `household.defaultCurrencyCode` (one household = one
  currency for MVP).
- `amount > 0`.
- `equal`: participants carry no amount; `allocate()` distributes evenly.
- `exact`: `sum(participant.amount) == amount`.
- `percentage`: `sum(percentage) == 100`; the monetary allocation derived from it
  must still sum exactly to `amount`.
- `shares`: `sum(allocate(amount, shares)) == amount`.
- A single participant at 100% is a **personal expense**: it is persisted and
  counted in household statistics, but nets to zero for that member since payer
  and participant are the same person — it creates no debt toward anyone else.
- Amounts round to `Currency.decimalPlaces` (never a hardcoded `2`).

## Invariants

- `sum(splits.amount) == expense.amount`, exactly, for all four strategies —
  including amounts that don't divide evenly (e.g. `100 / 3`).
- `expense.householdId` is immutable after creation (see void-expense.md).

## Authorization

`requireHouseholdMember()`.

## Persistence

Transactional: `Expense` + `ExpenseSplit[]` are created together or not at all
(`prisma.$transaction`).

## Transaction boundary

Single transaction wrapping the expense insert and the split rows.

## Errors

`HOUSEHOLD_NOT_FOUND`, `NOT_A_MEMBER`, `INVALID_PAYER`, `INVALID_PARTICIPANT`,
`INVALID_EXPENSE_SPLIT`, `INVALID_CATEGORY`, `INVALID_CURRENCY`,
`VALIDATION_ERROR`, `IDEMPOTENCY_KEY_CONFLICT`.

## API

`POST /households/:id/expenses` 🔒 — requires `Idempotency-Key`.

## Tests

- Sum invariant holds for `equal`/`exact`/`percentage`/`shares`, including
  `100 / 3`, a single participant, and a zero-decimal currency (CLP).
- Payer or participant not an active member → `422`.
- Category from a different household → `422`.
- Splits that don't sum to the total → `422`.
- Replaying the same `Idempotency-Key` returns the original response instead of
  creating a duplicate expense.

## Out of scope

Editing and voiding — see `void-expense.md`.
