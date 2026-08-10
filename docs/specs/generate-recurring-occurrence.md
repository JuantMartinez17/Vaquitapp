# Use Case: Generate Recurring Expense Occurrence

Feature: Generate Recurring Expense Occurrence

Goal: Turn a `RecurringExpense` definition into a concrete `pending` `Expense`
once its due date arrives, without ever double-generating — and without ever
executing a payment automatically.

Actors: System (the scheduler job) generates; a household member confirms or
skips.

Preconditions: `recurringExpense.isActive` and `nextRunDate <= today` in the
household's timezone.

## Input

Generation takes no HTTP input — it is cron-driven. Confirm/skip take
`expenseId`.

## Output

New `Expense` rows with `status: pending` and `recurringExpenseId` set;
`recurringExpense.nextRunDate` advanced past every occurrence generated.

## Business rules

- Generation is **deferred and explicit**, not a cron that silently creates
  finalized expenses: a daily job (gated by `ENABLE_SCHEDULER=true` on exactly
  one service instance) materializes overdue occurrences as `pending`.
- Idempotency: a partial unique index on `(recurring_expense_id, expense_date)`
  guarantees running the job twice on the same day cannot create a duplicate;
  the second attempt's insert conflict is caught and treated as a no-op.
- `nextRunDate` is computed in `Household.timezone` (default
  `America/Argentina/Buenos_Aires`) and advanced by `frequency`
  (`daily`/`weekly`/`monthly`/`yearly`) after each materialization, looping
  until `nextRunDate` is in the future — this lets the job catch up correctly
  if it didn't run for several days.
- A materialized occurrence copies the template's amount/category/payer/split
  at generation time; a later edit to the `RecurringExpense` does not
  retroactively change already-generated expenses.
- `GET .../recurring-expenses/upcoming` computes upcoming/overdue occurrences
  for display **without persisting them**, independent of whether the job has
  run yet.
- Confirm: `pending → active` (now counts toward balances). Skip: `pending →
voided` (never counts) — and does not block the next scheduled occurrence.
- Automatic payment execution is explicitly out of scope: this use case only
  ever creates a record.

## Invariants

- For a given `(recurringExpenseId, expenseDate)`, at most one `Expense` row
  ever exists.
- Running the job any number of times produces the same end state as running
  it once.

## Authorization

The generation job runs with system privileges (no `req.user`). Confirm/skip
go through `requireHouseholdMember()`, same as `void-expense.md`.

## Persistence

Per-occurrence transaction: create the `pending` `Expense` + its splits, then
advance `nextRunDate` — or no-op on a unique-constraint conflict.

## Transaction boundary

One transaction per occurrence generated, so a job restart never leaves a
half-generated expense.

## Errors

The job surfaces no errors to a client. Confirm/skip: `NOT_FOUND`,
`RECURRING_OCCURRENCE_NOT_PENDING`.

## API

`GET /households/:id/recurring-expenses/upcoming` 🔒 · `POST
/households/:id/expenses/:expenseId/confirm` 🔒 · `POST
/households/:id/expenses/:expenseId/skip` 🔒.

## Tests

- Running the job twice on the same day produces no duplicate.
- A job that missed 3 days catches up to 3 `pending` occurrences with
  correctly advanced `nextRunDate`.
- Confirm moves the occurrence into balance calculations; skip does not, and
  the following occurrence still generates on schedule.

## Out of scope

Reminders/notifications (D13); automatic payment execution.
