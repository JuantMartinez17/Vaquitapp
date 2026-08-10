-- Rename Group -> Household across the schema (vNext pivot, SPECS.md D0).
-- Plain renames only: nothing is dropped or recreated, so no data is lost.
-- Constraint and index names intentionally keep their pre-rename identifiers
-- (Postgres does not rename them automatically, and schema.prisma pins them
-- back with `map:` so Prisma sees no drift).

ALTER TABLE "groups" RENAME TO "households";
ALTER TABLE "group_members" RENAME TO "household_members";

ALTER TABLE "household_members" RENAME COLUMN "group_id" TO "household_id";
ALTER TABLE "invitations" RENAME COLUMN "group_id" TO "household_id";
ALTER TABLE "categories" RENAME COLUMN "group_id" TO "household_id";
ALTER TABLE "expenses" RENAME COLUMN "group_id" TO "household_id";
ALTER TABLE "recurring_expenses" RENAME COLUMN "group_id" TO "household_id";
ALTER TABLE "settlements" RENAME COLUMN "group_id" TO "household_id";
