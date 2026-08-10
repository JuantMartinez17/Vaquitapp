# Use Case: Edit or Void an Expense

Feature: Edit or Void an Active Expense

Goal: Change or retire a persisted financial fact without ever physically
deleting it — financial history must stay reconstructible.

Actors: Authenticated household member. Any active member may edit or void any
active expense in the household (not creator/payer-only), matching the
collaborative, Splitwise-like model where shared expenses are jointly managed.

Preconditions: `expense.status == active`; the requesting user is an active
member of `expense.householdId`.

## Input

- Edit: any subset of `{ description, amount, expenseDate, categoryId, paidBy,
splitType, participants[] }`. `currencyCode` cannot change (fixed to the
  household's currency) and `householdId` cannot change (see below).
- Void: no body beyond `expenseId`.

## Output

Edit → updated `ExpenseDto` with recalculated `splits[]`. Void → `204`.

## Business rules

- Editing **recalculates splits from scratch** in the same transaction: existing
  `ExpenseSplit` rows are replaced, not patched.
- `householdId` is immutable. Moving an expense to another household is not
  supported — void it and recreate it there instead. This avoids a large class
  of authorization and balance-recalculation bugs for a rare operation.
- Voiding sets `status: voided` (and `voidedAt`); the row and its splits stay in
  the database for history, but are excluded from balance calculation from that
  point on.
- Editing or voiding an already-voided expense → `409 EXPENSE_ALREADY_VOIDED`.
- The same participant/payer/category/currency validations as create-expense.md
  apply to the post-edit state.

## Invariants

- After an edit, `sum(new splits) == new amount` (same invariant as creation).
- A voided expense never contributes to `calculate-balances.md`.

## Authorization

`requireHouseholdMember()`.

## Persistence

Edit: one transaction — delete old splits, update the expense row, insert new
splits. Void: one transaction — update `status` (+ `voidedAt`).

## Transaction boundary

Both edit and void are single `prisma.$transaction` calls; no partial state is
ever visible.

## Errors

`EXPENSE_ALREADY_VOIDED`, `NOT_FOUND`, `NOT_A_MEMBER`, `INVALID_PAYER`,
`INVALID_PARTICIPANT`, `INVALID_EXPENSE_SPLIT`, `INVALID_CATEGORY`.

## API

`PATCH /households/:id/expenses/:expenseId` 🔒 (edit) · `DELETE
/households/:id/expenses/:expenseId` 🔒 (void, returns `204`).

## Tests

- Voiding twice → second call `409`.
- Editing replaces splits and preserves the sum invariant.
- A voided expense disappears from the default (active-only) listing and from
  balance calculation, but the row is still readable by id.

## Out of scope

Field-level audit trail of who changed what (deferred to the hardening phase,
D4); this use case only needs `updatedAt`/`voidedAt`.
