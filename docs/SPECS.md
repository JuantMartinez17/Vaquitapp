# Vaquitapp — Technical Product Specification

**Status:** Draft for Spec-Driven Development\
**Document:** `SPECS.md`\
**Version:** 0.1.0\
**Scope:** Product vision, MVP, domain model, business rules, architecture, API conventions, data model, security, testing, deployment and development workflow.

---

## 1. Product Definition

### 1.1 Vision

Vaquitapp is a **household-first financial organization system with Splitwise-compatible expense sharing**.

Its purpose is not merely to calculate who owes whom. It should act as a personal and household **economic agenda**, allowing users to:

- record financial activity;
- organize expenses;
- understand where money is being spent;
- manage shared expenses;
- calculate balances between household members;
- keep payment receipts and invoices;
- track recurring payments;
- monitor upcoming commitments;
- analyze financial behavior;
- establish budgets and savings goals.

The product should not become a bank, accounting system, or investment platform. Its focus is **everyday household financial organization**.

### 1.2 Product principle

The central product distinction is:

> **Splitwise answers "who owes whom?" Vaquitapp should additionally answer "what happened to our money, where did it go, what is coming next, and what are we trying to achieve?"**

### 1.3 Primary use case

A user should be able to use Vaquitapp as an economic agenda:

1. Record what happened.
2. Classify it.
3. Associate it with a household.
4. Identify who paid and who was economically responsible.
5. Attach supporting documentation when useful.
6. Let the system calculate balances.
7. Review historical and statistical information.
8. Anticipate recurring expenses.
9. Plan household objectives.

---

# 2. Product Scope

## 2.1 MVP

The MVP must prove the following hypothesis:

> A household can use Vaquitapp to record everyday financial activity and understand how much it spends, where it spends it, and how shared expenses are distributed among its members.

### MVP capabilities

#### Authentication

- User registration.
- Login.
- Access tokens.
- Refresh-token rotation.
- Logout/revocation.
- Password hashing.
- Basic profile management.

#### Households

- Create household.
- Invite members.
- Accept/reject invitations.
- List members.
- Household roles.
- Membership authorization.
- Remove/leave household according to business rules.

#### Expenses

- Create expense.
- Read expense.
- Update expense.
- Cancel/delete expense according to lifecycle rules.
- Amount.
- Currency.
- Date.
- Description.
- Category.
- Payer.
- Participants.
- Split strategy.
- Attachments.

Supported split strategies for MVP:

- Equal split.
- Exact amounts.
- Percentages.

#### Balances

- Calculate member balances.
- Determine net amount owed.
- Determine directional debt relationships.
- Simplify reciprocal balances.
- Register settlements.
- Recalculate balances after settlements.

#### Categories

- System/default categories.
- Household-specific categories where appropriate.
- Category filtering.
- Category-based statistics.

Initial category examples:

- Housing.
- Food.
- Transportation.
- Entertainment.
- Health.
- Hygiene.
- Education.
- Technology.
- Services.
- Other.

The category catalog is configurable and should not be hard-coded into business logic.

#### Recurring expenses

- Define recurring expense.
- Frequency.
- Amount.
- Category.
- Next occurrence.
- Active/inactive state.
- Upcoming-payment visibility.
- Basic reminders.

The MVP does not automatically execute payments.

#### Attachments

- Associate one or more files with an expense.
- Store metadata separately from the expense.
- Support receipts/invoices as the primary use case.
- File storage must be abstracted from domain logic.

OCR is explicitly out of MVP scope.

#### Analytics

Initial analytics:

- Total spending.
- Spending by category.
- Spending by member.
- Spending over time.
- Date filtering.
- Basic comparisons between periods.

---

# 3. Post-MVP / Product Evolution

The product should evolve toward a broader household financial system.

## 3.1 Planning

- Monthly budgets.
- Category budgets.
- Savings goals.
- Household projects.
- Progress toward financial objectives.
- Future expected expenses.

Examples:

- "Save $2,000,000 by December."
- "Spend no more than $300,000 on food this month."
- "Save $3,000,000 for a family project."

Goals and budgets are related but distinct concepts and should not be collapsed into one generic entity without explicit modeling.

## 3.2 Additional financial activity

Potential future entities:

- Bank accounts.
- Credit cards.
- Installments.
- Loans.
- Investments.
- Assets.

These are not part of the MVP.

## 3.3 Advanced integrations

Future possibilities:

- Bank integrations.
- Transaction imports.
- OCR.
- Automatic categorization.
- Advanced notifications.
- Multi-currency conversion.
- External exchange-rate providers.

These must not influence MVP complexity.

---

# 4. Explicit Non-Goals

Vaquitapp is not initially:

- a bank;
- an accounting/ERP platform;
- an investment platform;
- a tax-management system;
- an automatic payment processor;
- a complete personal-finance replacement for every possible use case.

Avoid turning the product into:

> Splitwise + YNAB + banking + cloud storage + calendar + accounting software.

The product should remain focused on **everyday household financial organization**.

---

# 5. Core Domain Model

## 5.1 Fundamental distinction

A **Household** represents the social/economic context in which financial activity is organized.

A **Category** represents the economic nature of an activity.

They are independent dimensions.

Example:

```text
Expense
  Household: Home
  Category: Food
  Description: Supermarket
  Amount: 85,000
  Payer: Juan
  Participants:
    Juan: 42,500
    Maria: 42,500
```

Another expense can belong to the same household but be:

```text
Category: Technology
Participants:
  Juan: 100%
```

Therefore:

> A personal expense can belong to a household without generating a debt toward another member.

---

# 6. Financial Activity Model

The domain must distinguish between **what happened economically** and the balances derived from those events.

Core activity types:

```text
Income
Expense
Transfer
Settlement
```

## 6.1 Expense

Represents consumption or an economic expense.

Examples:

- supermarket;
- rent;
- electricity;
- internet;
- entertainment subscription;
- hygiene products.

An expense contains at least:

- household;
- amount;
- currency;
- date;
- description;
- category;
- payer;
- participants;
- split information.

## 6.2 Income

Represents money entering the household/member financial context.

Examples:

- salary;
- freelance payment;
- refund;
- other income.

Income is not an expense and must not be represented as a negative expense.

## 6.3 Transfer

Represents movement of money without necessarily representing consumption.

Example:

> Juan transfers $200,000 to the household account.

A transfer is not inherently an expense.

## 6.4 Settlement

Represents a payment intended to reduce a balance between members.

Example:

> Maria pays Juan $50,000 to settle an outstanding shared-expense balance.

A settlement reduces a calculated obligation; it is not itself the original expense.

---

# 7. Balance Model

Balances are **derived from financial activity** rather than being the primary source of truth.

Example:

Juan pays:

```text
Supermarket = $100
Juan share   = $50
Maria share  = $50
```

The resulting net balance is:

```text
Juan:  +50
Maria: -50
```

If Maria pays another shared expense of $40:

```text
Juan share   = $20
Maria share  = $20
```

The net balance becomes:

```text
Juan:  +30
Maria: -30
```

The system can therefore present:

```text
Juan -> Maria: $30
```

A settlement of $30 returns both members to zero.

## 7.1 Balance invariants

- The sum of all member net balances for a household must equal zero for expense-sharing calculations.
- A member may have a positive balance (creditor), negative balance (debtor), or zero balance.
- Reciprocal obligations should be netted.
- Settlements reduce balances.
- Balance calculation must be deterministic and reproducible from persisted financial activity.
- The system must not rely on a mutable "current debt" value as the sole source of truth.

---

# 8. Expense Splitting

## 8.1 Payer

The payer is the household member who initially paid the expense.

The payer must belong to the household.

## 8.2 Participants

Participants represent the economic responsibility for the expense.

Every participant must belong to the household.

A participant can represent 100% responsibility for a personal expense.

## 8.3 Split strategies

### Equal

The system distributes the amount equally while preserving exact total value.

Example:

```text
100 / 3
= 33.34 + 33.33 + 33.33
```

The allocation algorithm must guarantee:

```text
sum(participant amounts) == expense amount
```

### Exact amounts

The caller specifies each participant's amount.

Invariant:

```text
sum(participant amounts) == expense amount
```

### Percentage

The caller specifies percentages.

Invariant:

```text
sum(percentages) == 100%
```

The resulting monetary allocation must still sum exactly to the expense total.

## 8.4 Money representation

Never use binary floating-point arithmetic for monetary business logic.

Use PostgreSQL `numeric/decimal` and Prisma `Decimal` (or an equivalent exact decimal representation in the domain layer).

All monetary calculations must preserve exact values.

---

# 9. Categories

Categories answer:

> "What kind of economic activity is this?"

They are independent from households/groups.

Examples:

```text
Housing
Food
Transportation
Entertainment
Health
Hygiene
Education
Technology
Services
Other
```

The implementation should allow the catalog to evolve without changing application code.

---

# 10. Recurring Expenses

Recurring expenses represent expected repeated expenses.

A recurring expense should contain:

- household;
- description;
- amount;
- currency;
- category;
- frequency;
- next occurrence;
- active/inactive status;
- optional participants/payer;
- optional attachments or metadata.

MVP behavior:

- show upcoming payments;
- identify overdue/upcoming occurrences;
- generate or suggest occurrences according to the chosen design;
- provide reminders.

Automatic payment execution is out of scope.

The exact semantics of occurrence generation must be defined before implementation.

---

# 11. Attachments

Attachments are supporting documents associated with financial activity.

Primary use cases:

- invoices;
- receipts;
- proof of payment;
- contracts/documentation.

The domain must not depend directly on a specific object-storage provider.

Use an abstraction such as:

```text
FileStorage
  upload()
  download()
  delete()
```

Persist metadata in PostgreSQL:

- attachment ID;
- owner/resource;
- original filename;
- MIME type;
- size;
- storage key;
- timestamps.

Actual binary content should be stored externally rather than directly in PostgreSQL unless a future requirement explicitly justifies otherwise.

---

# 12. Architecture

## 12.1 Target architecture

The backend will initially be a modular monolith.

Recommended high-level structure:

```text
Client
  |
  v
HTTP / Express
  |
  v
Routes
  |
  v
Validation / Authentication / Authorization
  |
  v
Controllers
  |
  v
Application Services / Use Cases
  |
  +--------------------+
  |                    |
  v                    v
Domain Logic        Repositories / Prisma
                         |
                         v
                     PostgreSQL
```

Additional infrastructure:

```text
Application
 ├── PostgreSQL
 ├── File Storage
 ├── Background Jobs
 └── Email/Notification Provider
```

Do not introduce microservices unless a concrete scaling or organizational requirement appears.

---

# 13. Technology Stack

The project documentation currently establishes the following technical direction:

| Concern           | Technology                   |
| ----------------- | ---------------------------- |
| Language          | TypeScript                   |
| Runtime           | Node.js                      |
| HTTP framework    | Express 5                    |
| Database          | PostgreSQL                   |
| ORM               | Prisma                       |
| Validation        | Zod                          |
| Authentication    | JWT + refresh-token rotation |
| Password hashing  | bcrypt                       |
| Money             | Decimal                      |
| Testing           | Node test runner + Supertest |
| Logging           | Pino                         |
| Containers        | Docker                       |
| Deployment target | Render initially             |
| API documentation | OpenAPI                      |
| Version control   | Git / GitHub                 |

The existing project material already follows a modular backend organization and explicitly uses TypeScript, Express, Prisma/PostgreSQL, Zod, JWT, bcrypt, Decimal, testing, Docker, logging, CI/CD and OpenAPI-related practices.

---

# 14. Backend Module Structure

Recommended structure:

```text
src/
├── app/
│   ├── app.ts
│   ├── config.ts
│   └── middleware/
│
├── modules/
│   ├── auth/
│   ├── users/
│   ├── households/
│   ├── invitations/
│   ├── expenses/
│   ├── categories/
│   ├── balances/
│   ├── settlements/
│   ├── incomes/
│   ├── transfers/
│   ├── recurring-expenses/
│   ├── attachments/
│   └── analytics/
│
├── domain/
│   ├── money/
│   ├── balances/
│   └── splitting/
│
├── infrastructure/
│   ├── database/
│   ├── storage/
│   └── logging/
│
├── shared/
│   ├── errors/
│   ├── types/
│   └── utils/
│
└── server.ts
```

The exact folder structure can evolve, but responsibilities should remain separated.

---

# 15. Layer Responsibilities

## Routes

Responsible for:

- HTTP route definitions;
- middleware composition;
- mapping endpoints to controllers.

Routes must not contain business logic.

## Controllers

Responsible for:

- reading HTTP input;
- invoking application services;
- mapping domain/application results to HTTP responses.

Controllers must remain thin.

## Validation

Zod schemas validate:

- request bodies;
- route parameters;
- query parameters.

Invalid input must fail before business logic executes.

## Application services / use cases

Responsible for orchestration:

- authorization checks required by the use case;
- transaction boundaries;
- coordinating domain operations;
- invoking repositories;
- producing application-level results.

## Domain logic

Responsible for rules that must remain independent of HTTP/database infrastructure.

Examples:

- split allocation;
- balance calculation;
- money operations;
- settlement netting;
- validation of domain invariants.

## Infrastructure

Responsible for:

- Prisma;
- PostgreSQL;
- file storage;
- logging;
- external providers.

---

# 16. Database Model — Initial Conceptual Schema

The initial relational model should include approximately:

```text
User
Household
HouseholdMember
Invitation

Category

Expense
ExpenseParticipant
Attachment

Income
Transfer
Settlement

RecurringExpense
```

Potential future entities:

```text
Budget
SavingsGoal
FinancialAccount
CreditCard
Installment
BankTransaction
```

These future entities must not be added to the MVP schema without an actual use case.

---

# 17. Key Relationships

Conceptually:

```text
User 1 ─── N HouseholdMember N ─── 1 Household

Household 1 ─── N Expense

Expense 1 ─── N ExpenseParticipant
User 1 ─── N Expense (payer)

Expense N ─── 1 Category

Expense 1 ─── N Attachment

Household 1 ─── N Income
Household 1 ─── N Transfer
Household 1 ─── N Settlement

Household 1 ─── N RecurringExpense
```

Every household-scoped resource must be associated with a household either directly or through a validated relationship.

---

# 18. Authorization Model

Household membership is the primary authorization boundary.

For every household-scoped operation:

1. Authenticate the user.
2. Resolve the household.
3. Verify membership.
4. Verify required role/permission.
5. Execute the use case.

Never trust a client-provided `householdId` without validating membership.

Example:

```text
Request
  |
  v
JWT valid?
  |
  v
User authenticated?
  |
  v
Member of household?
  |
  v
Has required permission?
  |
  v
Execute use case
```

Authorization must be enforced server-side.

---

# 19. Roles

MVP roles should remain simple.

Suggested:

```text
OWNER
MEMBER
```

The owner can:

- manage household;
- manage members/invitations;
- perform administrative actions.

Members can:

- view household data they are authorized to see;
- create/manage their permitted financial activity;
- participate in expenses;
- create settlements.

A granular RBAC system should not be introduced until actual requirements justify it.

---

# 20. Authentication

Use:

- short-lived access tokens;
- refresh tokens;
- refresh-token rotation;
- revocation;
- secure password hashing with bcrypt.

Refresh tokens should be persisted or otherwise tracked sufficiently to support rotation and revocation.

Do not store plaintext passwords or long-lived access tokens.

Environment secrets must never be committed.

---

# 21. API Conventions

Base path:

```text
/api/v1
```

Initial resource groups:

```text
/auth
/users
/households
/invitations
/categories
/expenses
/incomes
/transfers
/settlements
/recurring-expenses
/attachments
/balances
/analytics
```

Example endpoints:

```text
POST   /auth/register
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout

POST   /households
GET    /households
GET    /households/:id
PATCH  /households/:id

POST   /households/:id/invitations
GET    /households/:id/members

POST   /households/:id/expenses
GET    /households/:id/expenses
GET    /households/:id/expenses/:expenseId
PATCH  /households/:id/expenses/:expenseId
DELETE /households/:id/expenses/:expenseId

GET    /households/:id/balances
POST   /households/:id/settlements

POST   /households/:id/incomes
POST   /households/:id/transfers

POST   /households/:id/recurring-expenses
GET    /households/:id/recurring-expenses

GET    /households/:id/analytics/expenses
GET    /households/:id/analytics/categories
```

These are initial API candidates, not frozen contracts. Contracts must be finalized from use-case specifications.

---

# 22. API Error Model

Errors should have a stable machine-readable structure.

Example:

```json
{
  "error": {
    "code": "INVALID_EXPENSE_SPLIT",
    "message": "Expense participants do not sum to the expense total.",
    "details": {}
  }
}
```

Application error codes must be stable and documented.

HTTP status codes should communicate broad failure categories:

- `400` invalid request;
- `401` unauthenticated;
- `403` unauthorized;
- `404` resource not found;
- `409` business conflict;
- `422` semantically invalid input where appropriate;
- `429` rate limit;
- `500` unexpected server failure.

---

# 23. Transactions

Financial mutations must be transactional.

Creating an expense may involve:

```text
Expense
  +
Participants
  +
Attachments metadata
```

The financial state must never be partially persisted.

Likewise, settlement creation and any operation affecting derived balances must maintain transactional consistency.

Use PostgreSQL transactions through Prisma.

---

# 24. Concurrency and Consistency

Financial operations must be designed with concurrent requests in mind.

Important cases:

- two users editing the same expense;
- simultaneous settlements;
- duplicate requests;
- invitation acceptance races;
- recurring-expense generation.

Where required:

- use database transactions;
- use unique constraints;
- use idempotency keys for operations where duplicate execution would be harmful;
- use optimistic concurrency/versioning if later required.

Do not introduce distributed locking unless a concrete use case requires it.

---

# 25. Deletion and Auditability

Financial records should not be casually hard-deleted once they participate in balances or historical analytics.

Preferred lifecycle:

```text
ACTIVE
  |
  v
CANCELLED / VOIDED
```

rather than physically deleting historical financial facts.

The exact audit model must be finalized before implementing destructive operations.

Future audit requirements may include:

- who changed an expense;
- what changed;
- when;
- previous/new values.

---

# 26. Analytics

Analytics should be derived from persisted financial activity rather than stored as duplicated mutable counters.

MVP examples:

```text
Total spending
Spending by category
Spending by member
Spending by month
Recurring commitments
```

Avoid prematurely storing:

```text
monthlyTotal
categoryTotal
currentBalance
```

as authoritative values if they can be deterministically calculated.

Caching/materialized views can be introduced later for performance.

---

# 27. Performance

The initial architecture should prioritize correctness and maintainability over premature optimization.

Expected early requirements:

- indexed household foreign keys;
- indexed dates for financial activity;
- indexed category references;
- indexed membership lookups;
- pagination for expense history;
- bounded analytics queries.

Never return an unbounded expense history endpoint.

Use pagination:

```text
?page=1&limit=50
```

or cursor pagination when appropriate.

---

# 28. Testing Strategy

Testing is a first-class requirement.

## 28.1 Unit tests

Especially important for pure domain logic:

- equal split;
- exact split;
- percentage split;
- rounding;
- balance calculation;
- settlement netting;
- money operations.

## 28.2 Integration tests

Cover:

- authentication;
- household membership;
- expense persistence;
- participant validation;
- transaction behavior;
- settlements;
- recurring expenses.

## 28.3 API tests

Use Supertest for HTTP behavior.

Examples:

- unauthenticated access rejected;
- non-member access rejected;
- valid expense accepted;
- invalid split rejected;
- invalid category rejected;
- settlement correctly updates balance.

## 28.4 Invariant tests

Financial invariants deserve explicit tests.

Examples:

```text
sum(participants) == expense.total
sum(household member balances) == 0
```

for applicable balance calculations.

---

# 29. Security

Minimum requirements:

- bcrypt password hashing;
- JWT validation;
- refresh-token rotation;
- refresh-token revocation;
- authorization on every household resource;
- request validation;
- rate limiting on authentication endpoints;
- secure HTTP headers;
- CORS configured explicitly;
- no secrets in source control;
- structured security logging;
- file upload validation;
- file-size limits;
- MIME-type restrictions;
- authorization before file access.

Never trust:

- user IDs;
- household IDs;
- payer IDs;
- participant IDs;
- category IDs;
- attachment IDs

provided by the client without verifying ownership/membership/relationship.

---

# 30. Observability

Use structured logging with Pino.

Logs should include useful contextual information such as:

- request ID;
- user ID where appropriate;
- household ID where appropriate;
- operation;
- error code;
- duration.

Do not log:

- passwords;
- refresh tokens;
- access tokens;
- sensitive financial document contents.

Future additions:

- metrics;
- tracing;
- error monitoring;
- health checks.

---

# 31. Configuration

Configuration must come from environment variables.

Expected variables include concepts such as:

```text
DATABASE_URL
JWT_ACCESS_SECRET
JWT_REFRESH_SECRET
ACCESS_TOKEN_TTL
REFRESH_TOKEN_TTL
STORAGE_PROVIDER
STORAGE_BUCKET
STORAGE_CREDENTIALS
NODE_ENV
PORT
```

Actual variable names should be standardized before implementation.

Provide:

```text
.env.example
```

without secrets.

---

# 32. Environments

At minimum:

```text
development
test
production
```

Potential future:

```text
staging
```

Development and production databases must never be shared.

---

# 33. Docker

The application should be containerizable.

Development may use Docker Compose for:

```text
API
PostgreSQL
```

Production should use a reproducible container image.

Database migrations must run through the established deployment process rather than being manually applied.

---

# 34. CI/CD

CI should execute at minimum:

```text
install
lint
typecheck
unit tests
integration tests
build
```

Deployment must only occur after successful CI.

Database migration strategy must be explicitly defined before production deployment.

---

# 35. OpenAPI

The API must eventually have a generated/maintained OpenAPI specification.

OpenAPI should document:

- endpoints;
- parameters;
- request bodies;
- response schemas;
- authentication;
- errors;
- pagination;
- examples.

The OpenAPI contract should be treated as part of the product specification, not merely documentation added after implementation.

---

# 36. Spec-Driven Development Process

Development should follow:

```text
PRODUCT REQUIREMENT
        ↓
DOMAIN DECISION
        ↓
BUSINESS RULES
        ↓
USE CASE SPEC
        ↓
DATA MODEL
        ↓
API CONTRACT
        ↓
TEST CASES
        ↓
IMPLEMENTATION
        ↓
VALIDATION
```

A feature should not be considered ready for implementation if its core business rules are ambiguous.

---

# 37. Feature Specification Template

Every major feature should define:

```text
Feature:
Goal:
Actors:
Preconditions:

Input:
Output:

Business rules:
Invariants:
Authorization:

Persistence:
Transaction boundary:

Errors:

API:
Tests:

Out of scope:
```

Example:

```text
Feature: Create Expense

Actor:
Authenticated household member

Input:
- householdId
- amount
- currency
- description
- date
- categoryId
- payerId
- participants[]

Rules:
- user must belong to household
- payer must belong to household
- all participants must belong to household
- amount > 0
- participants must sum exactly to amount
- category must be valid

Transaction:
- create expense
- create participants
- persist attachment metadata if applicable

Errors:
- HOUSEHOLD_NOT_FOUND
- NOT_A_MEMBER
- INVALID_PAYER
- INVALID_PARTICIPANT
- INVALID_EXPENSE_SPLIT
- INVALID_CATEGORY
```

---

# 38. Recommended Development Order

## Phase 0 — Domain foundation

1. Finalize domain model.
2. Finalize financial activity definitions.
3. Finalize balance semantics.
4. Finalize split algorithms.
5. Define invariants.
6. Define lifecycle/deletion rules.

## Phase 1 — Infrastructure

1. TypeScript project.
2. Express.
3. PostgreSQL.
4. Prisma.
5. Configuration.
6. Logging.
7. Error handling.
8. Testing infrastructure.
9. Docker.
10. CI.

## Phase 2 — Authentication

1. Registration.
2. Login.
3. Access tokens.
4. Refresh rotation.
5. Logout/revocation.
6. Authorization middleware.

## Phase 3 — Households

1. Household creation.
2. Membership.
3. Invitations.
4. Roles.
5. Authorization.

## Phase 4 — Financial core

1. Categories.
2. Expenses.
3. Participants.
4. Split algorithms.
5. Balance calculation.
6. Settlements.

This is the first point at which the application demonstrates the original Splitwise-compatible capability.

## Phase 5 — Household finance

1. Income.
2. Transfers.
3. Recurring expenses.
4. Attachments.
5. Upcoming commitments.

## Phase 6 — Insights

1. Expense history.
2. Category analytics.
3. Member analytics.
4. Temporal analytics.
5. Basic dashboards.

## Phase 7 — Planning

Post-MVP:

1. Budgets.
2. Savings goals.
3. Household projects.

## Phase 8 — Hardening

1. Rate limiting.
2. Security review.
3. Performance review.
4. Observability.
5. OpenAPI finalization.
6. CI/CD hardening.
7. Backup/recovery validation.

---

# 39. Architectural Principles

The project must follow these principles:

### 1. Domain before infrastructure

Do not let Prisma schema design define the business model prematurely.

### 2. Financial facts are the source of truth

Balances and analytics should be derived whenever practical.

### 3. Exact money

No floating-point monetary calculations.

### 4. Authorization at the server

Membership and ownership are always verified server-side.

### 5. Modular monolith first

Do not introduce microservices without a concrete reason.

### 6. Thin controllers

Business logic belongs in use cases/domain services.

### 7. Pure financial algorithms

Splitting and balance algorithms should be testable without HTTP or database dependencies.

### 8. Explicit invariants

Financial correctness must be represented as executable tests.

### 9. Avoid premature abstraction

Do not build infrastructure for hypothetical requirements.

### 10. Preserve future extensibility

MVP decisions should not unnecessarily block future accounts, cards, imports, multi-currency, OCR or planning features.

---

# 40. Product Boundary Summary

The MVP is:

> **A household financial activity tracker with shared-expense management, balances, recurring expenses, documentation and basic analytics.**

The broader product is:

> **A household-first financial organization system that helps users understand, organize and plan their everyday economic life, while retaining the collaborative expense-sharing capabilities that made Splitwise useful.**

The key differentiator is therefore not:

> "Splitwise, but with more features."

It is:

> **"A household financial agenda in which expense sharing is a first-class capability."**

---

# 41. Definition of Done — MVP

The MVP is considered technically complete when:

- authentication works securely;
- household membership and authorization are enforced;
- users can record expenses;
- expenses can be split correctly;
- monetary calculations are exact;
- personal and shared expenses are both supported;
- balances are deterministically calculated;
- settlements can reduce balances;
- recurring expenses can be tracked;
- attachments can be associated with expenses;
- basic financial analytics are available;
- core domain invariants have automated tests;
- API integration tests cover critical workflows;
- database migrations are reproducible;
- configuration is environment-based;
- Docker execution works;
- CI passes lint, typecheck, tests and build;
- OpenAPI covers the implemented public API;
- no known critical authorization or financial-consistency issue remains.

---

# 42. Open Decisions Before Implementation

The following items must be explicitly resolved during domain-design before freezing the database/API contracts:

1. Exact household membership lifecycle.
2. Invitation expiration and revocation rules.
3. Expense lifecycle: edit/delete/void semantics.
4. Whether expense edits create an audit trail in MVP.
5. Exact recurring-expense occurrence-generation semantics.
6. Currency representation and MVP currency restrictions.
7. Attachment storage provider and retention policy.
8. Exact settlement semantics and whether settlements can be partial.
9. Whether transfers are MVP or introduced immediately after the expense core.
10. Initial income model.
11. Pagination strategy.
12. Idempotency requirements for financial mutations.
13. Notification mechanism for recurring expenses.
14. Exact category ownership model: global, household-specific, or both.
15. Whether a financial activity can be reassigned between households.
16. Time-zone rules for dates and recurring schedules.
17. API versioning policy.
18. Production backup/recovery strategy.

These are not blockers for the product definition, but they should be resolved before the corresponding feature is implemented.

---

# 43. Final Development Rule

No implementation should begin with:

> "Let's create the Prisma model."

The implementation should begin with:

> "Let's specify the use case."

Then:

```text
Use case
→ business rules
→ invariants
→ domain model
→ persistence model
→ API contract
→ tests
→ implementation
```

This document is therefore the **technical/product baseline** for the project, while individual feature specifications will provide the implementation-level contracts required for spec-driven development.
