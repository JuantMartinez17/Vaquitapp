# Use Case: Create Settlement

Feature: Create Settlement

Goal: Record a payment between two household members that reduces their
derived balance.

Actors: Authenticated household member — specifically, one of the two parties
involved (`fromUser` or `toUser`). A member cannot record a settlement between
two other people; that would let someone unilaterally declare a debt resolved
on another's behalf.

Preconditions: `fromUser ≠ toUser`; both are active members of the household;
`currencyCode` equals the household's currency; `amount > 0`.

## Input

`householdId`, `fromUser`, `toUser`, `amount`, `currencyCode`, `settlementDate`,
`notes?`, `Idempotency-Key` header (required).

## Output

`SettlementDto`, `status: confirmed`.

## Business rules

- Settlements are **partial by nature** — the amount is free-form and does not
  need to match the currently simplified debt.
- `status` is `confirmed` immediately; the `pending → confirmed` two-step flow
  is deferred (not needed until a "request confirmation from the other party"
  feature exists).
- `fromUser ≠ toUser`; both must be active members; `currencyCode` must equal
  the household's currency.
- `req.user.id` must be either `fromUser` or `toUser` — see Actors above.
- Voiding (`DELETE`) sets `status: voided`, never a physical delete; a voided
  settlement is excluded from balance calculation.

## Invariants

- Immediately after creation, recalculated balances move by exactly `±amount`
  between `fromUser` and `toUser`.
- A settlement equal to the simplified debt between two members zeroes both
  (cross-checked in `calculate-balances.md` tests).

## Authorization

`requireHouseholdMember()`, plus the "must be a party" check above.

## Persistence

Single insert; void is a single update. No child rows, so no multi-statement
transaction is required (unlike expenses).

## Transaction boundary

N/A — single-row mutation.

## Errors

`INVALID_SETTLEMENT`, `NOT_A_MEMBER`, `HOUSEHOLD_NOT_FOUND`,
`SETTLEMENT_ALREADY_VOIDED`, `INVALID_CURRENCY`, `FORBIDDEN`.

## API

`POST /households/:id/settlements` 🔒 (Idempotency-Key) · `GET
/households/:id/settlements` 🔒 (paginated) · `DELETE
/households/:id/settlements/:settlementId` 🔒 (void).

## Tests

- `fromUser == toUser` → `422`.
- Either party not an active member → `422`.
- Requesting user not a party to the settlement → `403`.
- Voiding twice → `409`.
- A partial settlement reduces but does not zero the balance.

## Out of scope

The `pending → confirmed` two-step flow (D8); cross-currency settlement
conversion.
