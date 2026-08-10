-- Align the schema with the "void, never delete" terminology used
-- throughout SPECS.md and README.vnext.md for financial facts (§25).
-- No expense data exists yet (F4 is the first module to write to this
-- table), so these renames are lossless and have nothing to backfill.

ALTER TYPE "ExpenseStatus" RENAME VALUE 'deleted' TO 'voided';
ALTER TABLE "expenses" RENAME COLUMN "deleted_at" TO "voided_at";

-- SPECS §8.3 and every use-case spec call this split strategy "exact", not
-- "fixed".
ALTER TYPE "SplitType" RENAME VALUE 'fixed' TO 'exact';
