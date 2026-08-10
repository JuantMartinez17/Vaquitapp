-- Household.timezone (D16): decides which calendar day a recurring
-- expense's occurrence is due on.
ALTER TABLE "households" ADD COLUMN "timezone" VARCHAR(50) NOT NULL DEFAULT 'America/Argentina/Buenos_Aires';

-- Idempotent occurrence generation (D5): running the daily job twice can't
-- create two Expense rows for the same (recurring_expense_id, expense_date).
-- NULL recurring_expense_id values never conflict with each other in
-- Postgres, so ordinary manually-created expenses are unaffected.
CREATE UNIQUE INDEX "expenses_recurring_expense_id_expense_date_key" ON "expenses"("recurring_expense_id", "expense_date");
