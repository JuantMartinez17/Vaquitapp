# Use Case: Accept or Reject Invitation

Feature: Accept or Reject Invitation

Goal: Let the invited person resolve a pending invitation into household
membership, or decline it.

Actors: Authenticated user whose account email matches `invitation.invitedEmail`
(case-insensitive) — including a user who registered _after_ the invitation was
sent.

Preconditions: `invitation.status == pending` and `invitation.expiresAt > now`.

## Input

`token` (route param). The action (`accept` | `reject`) is chosen by the
endpoint, not the body.

## Output

Accept → `MemberDto` for the new (or reactivated) membership. Reject → `204`.

## Business rules

- Only the invited person may resolve it: `req.user.email == invitation.invitedEmail`
  (case-insensitive), else `403`.
- Expiry is checked **before** status, so an expired-but-still-`pending` row
  reports `INVITATION_EXPIRED` rather than proceeding.
- Already-resolved (`accepted`/`rejected`) → `409 INVITATION_ALREADY_RESOLVED`.
- Accepting while already an active member of the household → `409
ALREADY_MEMBER` (race guard, see Invariants).
- If the user previously left this household (`leftAt` set), acceptance
  reactivates the existing `HouseholdMember` row (`leftAt = null`) instead of
  creating a duplicate — mirrors the reactivation behavior already used by
  direct member management.
- An invitation to an email with no account yet simply stays `pending`; it
  becomes actionable once that person registers, logs in, and calls accept
  with their token (discoverable via `GET /users/me/invitations`, matched by
  email).

## Invariants

A household never ends up with two active `HouseholdMember` rows for the same
user — enforced by wrapping the resolution in a transaction backed by the
unique `(householdId, userId)` constraint; a concurrent double-accept is
resolved to one success and one `ALREADY_MEMBER`, never a `500` or a duplicate
row (SPECS §24, acceptance race).

## Authorization

`authMiddleware` only — the user is deliberately _not_ required to already be
a household member, since accepting is how they become one. Ownership is
enforced by the `invitedEmail` check above, not by household membership.

## Persistence

`prisma.$transaction`: update `invitation.status`, then create or reactivate
the `HouseholdMember` row.

## Transaction boundary

Single transaction covering both writes.

## Errors

`INVITATION_NOT_FOUND`, `INVITATION_EXPIRED`, `INVITATION_ALREADY_RESOLVED`,
`ALREADY_MEMBER`, `FORBIDDEN`.

## API

`POST /invitations/:token/accept` 🔒 · `POST /invitations/:token/reject` 🔒 ·
`GET /users/me/invitations` 🔒 (my pending invitations, matched by email).

## Tests

- A token used by a different user's account → `403`.
- Expired invitation → `409 INVITATION_EXPIRED`.
- Two concurrent accepts of the same token → exactly one membership row, the
  other call gets `ALREADY_MEMBER`.
- Reject then accept the same token → `409 INVITATION_ALREADY_RESOLVED`.
- Accepting reactivates a previously-left member rather than duplicating.

## Out of scope

Email delivery of the invitation itself (D13).
