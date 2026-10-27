-- Index review against the actual query patterns. Only indexes change; no
-- table or column semantics. Each create below says which query it serves,
-- each drop says which index now covers it (left-prefix).

-- ---------------------------------------------------------------------------
-- expenses
-- ---------------------------------------------------------------------------

-- Keyset pagination of a status-filtered expense list, the activity feed
-- (status = 'active', ORDER BY expense_date DESC, id DESC) and the analytics
-- date-range scans. The `id` tail makes the ORDER BY fully index-ordered
-- instead of needing a sort for the tiebreak. Its (household_id, status)
-- prefix also serves the balance queries (all active expenses of a household).
CREATE INDEX "expenses_household_id_status_expense_date_id_idx"
  ON "expenses"("household_id", "status", "expense_date" DESC, "id" DESC);

-- The default expense list is `status <> 'voided'`, which cannot use the
-- index above for ordering (a range on status breaks the sort), so it needs
-- a status-free index with the same ordering.
CREATE INDEX "expenses_household_id_expense_date_id_idx"
  ON "expenses"("household_id", "expense_date" DESC, "id" DESC);

-- The `paidBy` list filter and the "paid" arm of the single-member net used
-- when a member leaves or is removed.
CREATE INDEX "expenses_household_id_status_paid_by_idx"
  ON "expenses"("household_id", "status", "paid_by");

-- Superseded by expenses_household_id_expense_date_id_idx (strict left prefix).
DROP INDEX "expenses_group_id_expense_date_idx";

-- ---------------------------------------------------------------------------
-- expense_splits
-- ---------------------------------------------------------------------------

-- Per-user lookups join back to expenses by expense_id; carrying it in the
-- index lets that side be answered from the index alone (member net, by-member
-- analytics).
CREATE INDEX "expense_splits_user_id_expense_id_idx"
  ON "expense_splits"("user_id", "expense_id");

-- Superseded by expense_splits_user_id_expense_id_idx (strict left prefix).
DROP INDEX "expense_splits_user_id_idx";

-- ---------------------------------------------------------------------------
-- settlements, incomes, transfers
-- ---------------------------------------------------------------------------

-- Keyset pagination orders by (date DESC, id DESC); the old indexes lacked
-- the id tiebreak. The household-prefix scans the balance queries do on
-- settlements are served by the same index, so no separate
-- (household_id, status) or from/to indexes are added: a household has few
-- settlements and the user filters apply to an already-tiny set.
CREATE INDEX "settlements_household_id_settlement_date_id_idx"
  ON "settlements"("household_id", "settlement_date" DESC, "id" DESC);
DROP INDEX "settlements_group_id_settlement_date_idx";

CREATE INDEX "incomes_household_id_income_date_id_idx"
  ON "incomes"("household_id", "income_date" DESC, "id" DESC);
DROP INDEX "incomes_household_id_income_date_idx";

CREATE INDEX "transfers_household_id_transfer_date_id_idx"
  ON "transfers"("household_id", "transfer_date" DESC, "id" DESC);
DROP INDEX "transfers_household_id_transfer_date_idx";

-- ---------------------------------------------------------------------------
-- recurring_expenses
-- ---------------------------------------------------------------------------

-- Listing and "upcoming" are household-scoped, exclude soft-deleted rows and
-- sort by next_run_date. The existing single-column next_run_date index is
-- kept: the generation job scans due templates across all households.
CREATE INDEX "recurring_expenses_household_id_deleted_at_next_run_date_idx"
  ON "recurring_expenses"("household_id", "deleted_at", "next_run_date");

-- ---------------------------------------------------------------------------
-- refresh_tokens
-- ---------------------------------------------------------------------------

-- A purge job deletes expired tokens (WHERE expires_at < now()); without this
-- it would sequentially scan the table on every run.
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- ---------------------------------------------------------------------------
-- invitations
-- ---------------------------------------------------------------------------

-- The invitee's inbox filters by (invited_email, status = 'pending').
CREATE INDEX "invitations_invited_email_status_idx"
  ON "invitations"("invited_email", "status");

-- Superseded by invitations_invited_email_status_idx (strict left prefix).
DROP INDEX "invitations_invited_email_idx";

-- ---------------------------------------------------------------------------
-- Housekeeping
-- ---------------------------------------------------------------------------

-- Pure rename to the name Prisma derives from the current table name (the
-- table was renamed from group_members in an earlier migration); keeps
-- `prisma migrate dev` from reporting drift.
ALTER INDEX "group_members_user_id_idx" RENAME TO "household_members_user_id_idx";

-- Deliberately NOT indexed: expenses.category_id and expenses.paid_by (single)
-- stay as they are; invitations.invited_user_id and settlements.from_user /
-- to_user are never filtered on, and referenced users are soft-deleted so the
-- foreign keys never need a reverse lookup.
