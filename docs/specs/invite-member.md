# Use Case: Invite Member to Household

Feature: Invite Member to Household

Goal: Let a household admin bring a new person in through an email-based
invitation, replacing direct-by-email member creation.

Actors: Household admin (inviter). The invitee is not necessarily a registered
user yet.

Preconditions: The inviter is an `admin` of the household.

## Input

`householdId`, `invitedEmail`.

## Output

`InvitationDto`: `{ id, householdId, invitedEmail, status: pending, expiresAt,
createdAt }`. The raw `token` is returned only in this response (it is the
invitation link's secret) and is never exposed again through a listing
endpoint.

## Business rules

- `token`: opaque, 128 characters, single use.
- TTL: 7 days from creation.
- At most one `pending` invitation per `(householdId, invitedEmail)` —
  enforced with a partial unique index on `status = 'pending'`.
- `invitedEmail` may or may not match an existing `User`; if it does,
  `invitedUserId` is recorded at creation for convenience, but resolution still
  only happens through explicit acceptance.
- Direct member addition (`POST /households/:id/members` with a body email) is
  removed; this invitation flow is the only way to add a member.
- Re-inviting after the previous invitation expired or was rejected is allowed
  — that row is no longer `pending`, so it doesn't collide with the new one.

## Invariants

At most one `pending` invitation exists per `(household, email)` at any time;
an expired invitation can never transition to `accepted`.

## Authorization

`requireHouseholdMember('admin')`.

## Persistence

Single insert; the partial unique index is what actually enforces the
one-pending-per-email rule under concurrent requests.

## Transaction boundary

N/A — single-row mutation, constraint-enforced.

## Errors

`INSUFFICIENT_ROLE`, `HOUSEHOLD_NOT_FOUND`, `VALIDATION_ERROR`,
`INVITATION_ALREADY_PENDING`.

## API

`POST /households/:id/invitations` 🔒 admin · `GET
/households/:id/invitations` 🔒 admin (all statuses) · `DELETE
/households/:id/invitations/:invitationId` 🔒 admin (revoke, only while
`pending`).

## Tests

- A second invite to the same pending `(household, email)` → `409`.
- Non-admin inviter → `403`.
- Revoking a non-`pending` invitation → `409`.
- The generated token has no collisions across many invitations (sanity check
  on randomness, not a security proof).

## Out of scope

Actually delivering the email (D13 — no SMTP/push in the MVP; the token is
surfaced to the caller and it is the client's job to communicate it for now).
