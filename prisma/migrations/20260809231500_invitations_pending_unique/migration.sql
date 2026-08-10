-- At most one PENDING invitation per (household, email). A partial/filtered
-- unique index has no equivalent in Prisma Schema Language, so it isn't
-- declared in schema.prisma — it only exists here. This lets a new
-- invitation be created after a previous one to the same email expired,
-- was rejected, or was revoked, while still blocking duplicate pending ones.
CREATE UNIQUE INDEX "invitations_pending_household_email_key"
  ON "invitations" ("household_id", "invited_email")
  WHERE "status" = 'pending';
