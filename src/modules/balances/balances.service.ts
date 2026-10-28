import { Decimal } from 'decimal.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { NotFoundError } from '../../shared/errors/errors.js';
import { ErrorCode } from '../../shared/errors/codes.js';
import { simplifyDebts } from '../../domain/balances/balance.js';
import type { Balance } from '../../domain/balances/balance.js';
import { formatMoney } from '../../domain/money/money.js';

/** Either the global client or an interactive-transaction client. */
export type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * One (user, signed delta) row per money movement, mirroring
 * `calculateBalances` in src/domain/balances: expense paid (+), own split
 * (−), settlement paid (+), settlement received (−). Expenses count when
 * `active` (voided and pending occurrences are not facts yet); settlements
 * count unless `voided`. Both the full-household query and the single-member
 * helper are built from this fragment, so they cannot drift apart.
 *
 * The JS `calculateBalances` stays as the oracle that balances.itest.ts
 * compares this SQL against.
 */
const balanceDeltas = (householdId: string, userId?: string): Prisma.Sql => {
  const only = (column: string): Prisma.Sql =>
    userId ? Prisma.sql` AND ${Prisma.raw(column)} = ${userId}::uuid` : Prisma.empty;
  return Prisma.sql`
    SELECT e."paid_by" AS user_id, e."amount" AS delta
      FROM "expenses" e
      WHERE e."household_id" = ${householdId}::uuid AND e."status" = 'active'${only('e."paid_by"')}
    UNION ALL
    SELECT s."user_id", -s."amount"
      FROM "expense_splits" s
      JOIN "expenses" e ON e."id" = s."expense_id"
      WHERE e."household_id" = ${householdId}::uuid AND e."status" = 'active'${only('s."user_id"')}
    UNION ALL
    SELECT st."from_user", st."amount"
      FROM "settlements" st
      WHERE st."household_id" = ${householdId}::uuid AND st."status" <> 'voided'${only('st."from_user"')}
    UNION ALL
    SELECT st."to_user", -st."amount"
      FROM "settlements" st
      WHERE st."household_id" = ${householdId}::uuid AND st."status" <> 'voided'${only('st."to_user"')}
  `;
};

/**
 * Net balance of a single member (positive = owed money). One round trip;
 * pass a transaction client to evaluate it inside the caller's transaction.
 */
export const getMemberNet = async (
  db: DbClient,
  householdId: string,
  userId: string,
): Promise<Decimal> => {
  const rows = await db.$queryRaw<{ net: string }[]>`
    SELECT COALESCE(SUM(d.delta), 0)::text AS net FROM (${balanceDeltas(householdId, userId)}) d
  `;
  return new Decimal(rows[0]?.net ?? 0);
};

interface MemberNetRow {
  user_id: string;
  display_name: string | null;
  net: string;
  is_active_member: boolean;
}

export interface MemberNet extends Balance {
  displayName: string | null;
  isFormerMember: boolean;
}

/**
 * Per-user net for every user with activity in the household, aggregated in
 * Postgres. Sums are cast to text so the Decimal never goes through a JS
 * float. A former member is kept only while their net is non-zero: they
 * still owe or are owed money, but a settled-up leaver is just noise.
 */
const queryMemberNets = async (householdId: string): Promise<MemberNet[]> => {
  const rows = await prisma.$queryRaw<MemberNetRow[]>`
    SELECT d.user_id,
           u."display_name" AS display_name,
           SUM(d.delta)::text AS net,
           (m."id" IS NOT NULL AND m."left_at" IS NULL) AS is_active_member
    FROM (${balanceDeltas(householdId)}) d
    JOIN "users" u ON u."id" = d.user_id
    LEFT JOIN "household_members" m
      ON m."household_id" = ${householdId}::uuid AND m."user_id" = d.user_id
    GROUP BY d.user_id, u."display_name", m."id", m."left_at"
  `;

  return rows
    .map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      net: new Decimal(row.net),
      isFormerMember: !row.is_active_member,
    }))
    .filter((member) => !member.isFormerMember || !member.net.isZero())
    .sort((a, b) => a.userId.localeCompare(b.userId));
};

const loadHouseholdCurrency = async (householdId: string) => {
  const household = await prisma.household.findFirst({
    where: { id: householdId, deletedAt: null },
    select: { defaultCurrencyCode: true, defaultCurrency: { select: { decimalPlaces: true } } },
  });
  if (!household) {
    throw new NotFoundError('Household not found', ErrorCode.HOUSEHOLD_NOT_FOUND);
  }
  return household;
};

export const getBalances = async (householdId: string) => {
  const household = await loadHouseholdCurrency(householdId);
  const members = await queryMemberNets(householdId);
  return {
    currencyCode: household.defaultCurrencyCode,
    balances: members.map((member) => ({
      userId: member.userId,
      displayName: member.displayName,
      net: formatMoney(member.net, household.defaultCurrency.decimalPlaces),
      isFormerMember: member.isFormerMember,
    })),
  };
};

export const getSimplifiedBalances = async (householdId: string) => {
  const household = await loadHouseholdCurrency(householdId);
  const members = await queryMemberNets(householdId);
  const memberById = new Map(members.map((member) => [member.userId, member]));

  return {
    currencyCode: household.defaultCurrencyCode,
    simplified: simplifyDebts(members).map((transfer) => {
      const from = memberById.get(transfer.from);
      const to = memberById.get(transfer.to);
      return {
        from: transfer.from,
        fromDisplayName: from?.displayName ?? null,
        fromIsFormerMember: from?.isFormerMember ?? false,
        to: transfer.to,
        toDisplayName: to?.displayName ?? null,
        toIsFormerMember: to?.isFormerMember ?? false,
        amount: formatMoney(transfer.amount, household.defaultCurrency.decimalPlaces),
      };
    }),
  };
};
