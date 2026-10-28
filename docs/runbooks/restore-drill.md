# Runbook: Backup Restore Drill (D18)

Goal: prove that a Vaquitapp database backup can actually be restored, and
that nobody is discovering how to do it for the first time during a real
incident.

> **Status: the production database will be Neon, not Render Postgres.** The
> "production restore" procedure below was written for Render's managed
> Postgres and **does not apply as-is** to Neon. Only the local drill has been
> run so far. Redo the drill against Neon before go-live — see
> [Before go-live (Neon)](#before-go-live-neon).

Run this drill whenever the schema changes meaningfully (a new required
table, a changed backup/restore-relevant extension) and at least once before
any release considered MVP-complete — not on every deploy.

## Procedure — production restore (Render managed Postgres, superseded by Neon)

1. In the Render dashboard, open the target Postgres instance → **Backups**.
2. Pick the backup to restore (point-in-time or a daily snapshot) and choose
   **Restore to a new database** — never restore over the live instance
   directly; a bad backup or a wrong pick must not take down production.
3. Once the new instance is ready, point a throwaway copy of the API
   (a manually deployed instance, or a local checkout with `DATABASE_URL`
   swapped to the restored instance's connection string) at it.
4. Verify with the checks in [Verification](#verification) below.
5. If the restore is good and this is a real incident: swap `DATABASE_URL`
   on the real service to the restored instance (Render → service →
   Environment), or use Render's "Promote" action if available for the plan.
6. If this is a drill, not an incident: delete the restored instance once
   verification passes. Record the run in [Drill log](#drill-log).

## Procedure — local / dev drill

Exercises the same `pg_dump` / `pg_restore` mechanics against the local
`vaquitapp-postgres` container (see `docker-compose.yml`), without touching
Render. This is what actually gets run for the periodic drill.

```bash
# 1. Back up the live dev database.
docker exec vaquitapp-postgres pg_dump -U vaquitapp -d vaquitapp -F c -f /tmp/vaquitapp_drill.dump

# 2. Restore into a scratch database, never over the original.
docker exec vaquitapp-postgres psql -U vaquitapp -d vaquitapp -c "CREATE DATABASE vaquitapp_restore_drill;"
docker exec vaquitapp-postgres pg_restore -U vaquitapp -d vaquitapp_restore_drill --no-owner --no-privileges /tmp/vaquitapp_drill.dump

# 3. Verify (see below), then clean up.
docker exec vaquitapp-postgres psql -U vaquitapp -d vaquitapp -c "DROP DATABASE vaquitapp_restore_drill;"
docker exec vaquitapp-postgres rm /tmp/vaquitapp_drill.dump
```

(On Windows Git Bash, prefix the `docker exec` calls with `MSYS_NO_PATHCONV=1`
— otherwise Git Bash rewrites `/tmp/...` into a Windows host path before it
ever reaches the container.)

## Before go-live (Neon)

TODO checklist — none of this has been done yet, and the Neon-specific details
(retention window, how point-in-time restore or branching is exposed, limits of
the free plan) must be read from Neon's current documentation rather than
assumed:

- [ ] Find out which backup / point-in-time restore options the Neon plan in
      use actually includes, and how far back they reach. Write it down here.
- [ ] Restore a Neon backup (or point in time) into a **new** database or
      branch, never over the live one.
- [ ] Point a throwaway copy of the API at the restored database, using the
      same kind of connection string the real service uses.
- [ ] Run every check in [Verification](#verification): row counts, content
      checksum, migration history, and `GET /health/ready`.
- [ ] Note that migrations run by hand against Neon's **direct** URL (the one
      without `-pooler`); do the same when checking `prisma migrate status`
      on the restored copy.
- [ ] Record the run in the [Drill log](#drill-log) and update the production
      procedure above so it describes Neon instead of Render.

## Verification

A restore isn't "done" until the data is confirmed intact, not just that
the commands exited 0:

- **Row counts match** the source for the tables that matter most
  (`users`, `households`, `expenses`, `settlements`, `expense_splits`).
- **A content checksum matches**, not just a count — a table could gain and
  lose the same number of rows and still look fine by count alone:
  ```sql
  SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM expenses;
  ```
  run against both the source and the restored copy, expecting an identical
  hash.
- **Migration history is intact**: `_prisma_migrations` has the same number
  of applied rows, and `npx prisma migrate status` against the restored
  database reports no drift.
- **The app actually boots against it**: point `DATABASE_URL` at the
  restored database and hit `GET /health/ready` — confirms the backup isn't
  just structurally valid but usable by the real application.

## Drill log

| Date       | Run by                      | Source rows (users / households / expenses / settlements) | Result                                                                                                                                                                                                        |
| ---------- | --------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-10 | Claude (autonomous session) | 1003 / 552 / 680 / 51                                     | Pass — row counts and expenses id-set checksum matched exactly (`7f275dcd5c72e3663471ab8700493376`); all 8 migrations present in the restored copy. Backup ~579 KB, dump <1s, restore ~1s (local dev volume). |
