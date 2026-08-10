-- Same "void, never delete" terminology fix as the previous migration,
-- applied to settlements (SPECS §25 covers every financial fact, not just
-- expenses). No settlement data exists yet, so this is lossless.

ALTER TYPE "SettlementStatus" RENAME VALUE 'cancelled' TO 'voided';
ALTER TABLE "settlements" RENAME COLUMN "deleted_at" TO "voided_at";
