import { prisma } from '../../infrastructure/database/prisma.js';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/errors.js';
import { ErrorCode } from '../../shared/errors/codes.js';
import type { Household, MemberRole, Prisma } from '../../generated/prisma/client.js';
import { getMemberNet } from '../balances/balances.service.js';
import { MEMBER_INCLUDE, toHouseholdDto, toMemberDto } from './households.mapper.js';
import type { HouseholdDto, MemberDto } from './households.mapper.js';
import type { CreateHouseholdDto, UpdateHouseholdDto } from './households.schema.js';

const assertCurrencyExists = async (code: string): Promise<void> => {
  const currency = await prisma.currency.findUnique({ where: { code } });
  if (!currency) {
    throw new BadRequestError(`Unsupported currency: ${code}`);
  }
};

const countActiveMembers = (householdId: string): Promise<number> =>
  prisma.householdMember.count({ where: { householdId, leftAt: null } });

/** Loads an active (non-deleted) household, or throws HOUSEHOLD_NOT_FOUND. Reused by every other household-scoped module. */
export const assertHouseholdActive = async (householdId: string): Promise<Household> => {
  const household = await prisma.household.findFirst({
    where: { id: householdId, deletedAt: null },
  });
  if (!household) {
    throw new NotFoundError('Household not found', ErrorCode.HOUSEHOLD_NOT_FOUND);
  }
  return household;
};

/** Confirms every given user is an active member of the household. Reused by every module that references users by id (payer, participants, parties). */
export const assertActiveMembers = async (
  householdId: string,
  userIds: string[],
  code: ErrorCode,
): Promise<void> => {
  const uniqueIds = [...new Set(userIds)];
  const count = await prisma.householdMember.count({
    where: { householdId, userId: { in: uniqueIds }, leftAt: null },
  });
  if (count !== uniqueIds.length) {
    throw new ValidationError('All specified users must be active members of this household', code);
  }
};

export const createHousehold = async (
  userId: string,
  dto: CreateHouseholdDto,
): Promise<HouseholdDto> => {
  if (dto.defaultCurrencyCode) {
    await assertCurrencyExists(dto.defaultCurrencyCode);
  }

  const household = await prisma.$transaction(async (tx) => {
    const created = await tx.household.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        defaultCurrencyCode: dto.defaultCurrencyCode ?? 'ARS',
        createdBy: userId,
      },
    });
    await tx.householdMember.create({
      data: { householdId: created.id, userId, role: 'admin' },
    });
    return created;
  });

  return toHouseholdDto(household, { role: 'admin', memberCount: 1 });
};

export const listHouseholdsForUser = async (userId: string): Promise<HouseholdDto[]> => {
  const memberships = await prisma.householdMember.findMany({
    where: { userId, leftAt: null, household: { deletedAt: null } },
    include: { household: true },
    orderBy: { joinedAt: 'desc' },
  });

  const counts = await prisma.householdMember.groupBy({
    by: ['householdId'],
    where: { householdId: { in: memberships.map((m) => m.householdId) }, leftAt: null },
    _count: { _all: true },
  });
  const countByHousehold = new Map(counts.map((c) => [c.householdId, c._count._all]));

  return memberships.map((m) =>
    toHouseholdDto(m.household, {
      role: m.role,
      memberCount: countByHousehold.get(m.householdId) ?? 1,
    }),
  );
};

export const getHousehold = async (
  householdId: string,
  role: MemberRole,
): Promise<HouseholdDto> => {
  const household = await assertHouseholdActive(householdId);
  return toHouseholdDto(household, { role, memberCount: await countActiveMembers(householdId) });
};

/**
 * Serializes concurrent membership and settings changes on one household by
 * taking its row lock for the rest of the transaction. Callers must pass the
 * interactive-transaction client so the lock lives as long as their checks.
 */
export const lockHousehold = async (
  tx: Prisma.TransactionClient,
  householdId: string,
): Promise<void> => {
  await tx.$queryRaw`SELECT "id" FROM "households" WHERE "id" = ${householdId}::uuid FOR UPDATE`;
};

/**
 * Any financial record, voided or soft-deleted included, pins the currency:
 * amounts are stored without a conversion, so changing the default
 * afterwards would silently reinterpret history.
 */
const hasFinancialActivity = async (
  tx: Prisma.TransactionClient,
  householdId: string,
): Promise<boolean> => {
  const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
    SELECT (
      EXISTS (SELECT 1 FROM "expenses" WHERE "household_id" = ${householdId}::uuid)
      OR EXISTS (SELECT 1 FROM "settlements" WHERE "household_id" = ${householdId}::uuid)
      OR EXISTS (SELECT 1 FROM "incomes" WHERE "household_id" = ${householdId}::uuid)
      OR EXISTS (SELECT 1 FROM "transfers" WHERE "household_id" = ${householdId}::uuid)
      OR EXISTS (SELECT 1 FROM "recurring_expenses" WHERE "household_id" = ${householdId}::uuid)
    ) AS locked
  `;
  return row?.locked ?? false;
};

export const updateHousehold = async (
  householdId: string,
  dto: UpdateHouseholdDto,
): Promise<HouseholdDto> => {
  if (dto.defaultCurrencyCode) {
    await assertCurrencyExists(dto.defaultCurrencyCode);
  }
  const household = await prisma.$transaction(async (tx) => {
    await lockHousehold(tx, householdId);
    if (dto.defaultCurrencyCode) {
      const current = await tx.household.findUniqueOrThrow({
        where: { id: householdId },
        select: { defaultCurrencyCode: true },
      });
      if (
        current.defaultCurrencyCode !== dto.defaultCurrencyCode &&
        (await hasFinancialActivity(tx, householdId))
      ) {
        throw new ConflictError(
          'The currency cannot change once the household has financial activity',
          ErrorCode.HOUSEHOLD_CURRENCY_LOCKED,
        );
      }
    }
    return tx.household.update({ where: { id: householdId }, data: dto });
  });
  return toHouseholdDto(household, { memberCount: await countActiveMembers(householdId) });
};

export const softDeleteHousehold = async (householdId: string): Promise<void> => {
  await prisma.household.update({ where: { id: householdId }, data: { deletedAt: new Date() } });
};

export const listMembers = async (householdId: string): Promise<MemberDto[]> => {
  const members = await prisma.householdMember.findMany({
    where: { householdId, leftAt: null },
    include: MEMBER_INCLUDE,
    orderBy: { joinedAt: 'asc' },
  });
  return members.map(toMemberDto);
};

/**
 * Counted under the household lock, so two concurrent removals or demotions
 * cannot both observe "another admin remains".
 */
const assertNotLastAdmin = async (
  tx: Prisma.TransactionClient,
  householdId: string,
): Promise<void> => {
  const adminCount = await tx.householdMember.count({
    where: { householdId, role: 'admin', leftAt: null },
  });
  if (adminCount <= 1) {
    throw new ConflictError('The household needs at least one admin', ErrorCode.LAST_ADMIN);
  }
};

/**
 * Marks a member as having left. The row is kept because their past
 * expenses and settlements still reference them. A non-zero net balance
 * blocks it: the money they owe or are owed would have no one to settle
 * with. Pending recurring occurrences are not facts and do not count.
 */
const deactivateMember = async (householdId: string, targetUserId: string): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    await lockHousehold(tx, householdId);

    const member = await tx.householdMember.findFirst({
      where: { householdId, userId: targetUserId, leftAt: null },
      select: { id: true, role: true },
    });
    if (!member) {
      throw new NotFoundError('The user is not a member of the household', ErrorCode.NOT_A_MEMBER);
    }
    if (member.role === 'admin') {
      await assertNotLastAdmin(tx, householdId);
    }

    const net = await getMemberNet(tx, householdId, targetUserId);
    if (!net.isZero()) {
      throw new ConflictError(
        'The member has an open balance and must settle up first',
        ErrorCode.MEMBER_HAS_OPEN_BALANCE,
        { net: net.toFixed() },
      );
    }

    await tx.householdMember.update({ where: { id: member.id }, data: { leftAt: new Date() } });
  });
};

/** Admin-initiated removal of a member (possibly the admin themselves). */
export const removeMember = (householdId: string, targetUserId: string): Promise<void> =>
  deactivateMember(householdId, targetUserId);

/** Self-service exit; the route already confirmed an active membership. */
export const leaveHousehold = (householdId: string, userId: string): Promise<void> =>
  deactivateMember(householdId, userId);

export const changeMemberRole = (
  householdId: string,
  targetUserId: string,
  role: MemberRole,
): Promise<MemberDto> =>
  prisma.$transaction(async (tx) => {
    await lockHousehold(tx, householdId);

    const member = await tx.householdMember.findFirst({
      where: { householdId, userId: targetUserId, leftAt: null },
      include: MEMBER_INCLUDE,
    });
    if (!member) {
      throw new NotFoundError('The user is not a member of the household', ErrorCode.NOT_A_MEMBER);
    }
    if (member.role === role) {
      return toMemberDto(member);
    }
    if (member.role === 'admin') {
      await assertNotLastAdmin(tx, householdId);
    }

    const updated = await tx.householdMember.update({
      where: { id: member.id },
      data: { role },
      include: MEMBER_INCLUDE,
    });
    return toMemberDto(updated);
  });
