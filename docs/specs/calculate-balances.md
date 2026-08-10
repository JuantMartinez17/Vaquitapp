# Use Case: Calculate Household Balances

Feature: Calculate Household Balances

Goal: Derive, for each member, how much they are owed or owe within a
household — purely from persisted financial activity, never from a stored
mutable field.

Actors: Any active household member (read-only).

Preconditions: None beyond membership.

## Input

`householdId` (route). Implicit inputs: every `active` `Expense` (with its
`splits`) and every non-`voided` `Settlement` in the household. `Income` and
`Transfer` are explicitly excluded — they never move balances between members.

## Output

- `GET /balances`: `[{ userId, net: "<decimal string>" }]`, where
  `sum(net) == 0`.
- `GET /balances/simplified`: `[{ from, to, amount }]` — the minimal set of
  transfers that clears every reciprocal debt.

## Business rules

- `net(member) = Σ(amount paid as payer on active expenses) − Σ(own split on
active expenses) + Σ(settlements received, non-voided) − Σ(settlements paid,
non-voided)`.
- Only `active` expenses and non-`voided` settlements are included.
- A member who left the household (`leftAt` set) cannot have done so with a
  non-zero balance (enforced at leave-time), but their historical expenses keep
  counting toward the balances of members who remain — the balance endpoint
  only _lists_ currently active members, it does not exclude past activity from
  the sums.
- Debt simplification nets reciprocal obligations and minimizes the number of
  transfers: repeatedly match the largest creditor against the largest debtor;
  ties break by `userId` for determinism.

## Invariants

- `Σ(net balances)` over all members who ever had activity `== 0`, exactly, in
  every scenario.
- `calculateBalances` is a **pure function** `(activity[]) → Balance[]` living
  in `src/domain/balances/` — no Prisma, no HTTP (see CODESTYLE.md §4.5).
  Same input always produces the same output.

## Authorization

`requireHouseholdMember()`.

## Persistence

Read-only. The service loads active expenses+splits and non-voided settlements
and hands them to the pure domain function — no writes, nothing cached.

## Transaction boundary

Not applicable (read-only, derived data — SPECS §26 explicitly warns against
storing this as an authoritative mutable value).

## Errors

`HOUSEHOLD_NOT_FOUND`, `NOT_A_MEMBER`.

## Tests

- Zero-sum invariant holds across randomized activity scenarios.
- The worked example from `SPECS.md` §7 (Juan/Maria, $100 and $40 expenses)
  simplifies to a single `$30` transfer.
- A settlement of the exact simplified amount zeroes both members.
- Voiding an expense recalculates the balance correctly on the next read.
- Incomes and transfers never change the result.

## Out of scope

Caching or materializing balances as a stored counter (SPECS §26); multi-hop
simplification across more than the reciprocal pair is in scope, but
cross-currency netting is not (one household = one currency for MVP).
