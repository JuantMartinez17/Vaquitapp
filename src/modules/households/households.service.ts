import { prisma } from '../../infrastructure/database/prisma.js';
import { BadRequestError, NotFoundError } from '../../shared/errors/errors.js';
import { ErrorCode } from '../../shared/errors/codes.js';
import type { MemberRole } from '../../generated/prisma/client.js';
import { toHouseholdDto, toMemberDto } from './households.mapper.js';
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
  const household = await prisma.household.findFirst({
    where: { id: householdId, deletedAt: null },
  });
  if (!household) {
    throw new NotFoundError('Household not found', ErrorCode.HOUSEHOLD_NOT_FOUND);
  }
  return toHouseholdDto(household, { role, memberCount: await countActiveMembers(householdId) });
};

export const updateHousehold = async (
  householdId: string,
  dto: UpdateHouseholdDto,
): Promise<HouseholdDto> => {
  if (dto.defaultCurrencyCode) {
    await assertCurrencyExists(dto.defaultCurrencyCode);
  }
  const household = await prisma.household.update({ where: { id: householdId }, data: dto });
  return toHouseholdDto(household, { memberCount: await countActiveMembers(householdId) });
};

export const softDeleteHousehold = async (householdId: string): Promise<void> => {
  await prisma.household.update({ where: { id: householdId }, data: { deletedAt: new Date() } });
};

export const listMembers = async (householdId: string): Promise<MemberDto[]> => {
  const members = await prisma.householdMember.findMany({
    where: { householdId, leftAt: null },
    include: { user: true },
    orderBy: { joinedAt: 'asc' },
  });
  return members.map(toMemberDto);
};

export const removeMember = async (householdId: string, targetUserId: string): Promise<void> => {
  const member = await prisma.householdMember.findFirst({
    where: { householdId, userId: targetUserId, leftAt: null },
  });
  if (!member) {
    throw new NotFoundError('The user is not a member of the household', ErrorCode.NOT_A_MEMBER);
  }

  if (member.role === 'admin') {
    const adminCount = await prisma.householdMember.count({
      where: { householdId, role: 'admin', leftAt: null },
    });
    if (adminCount <= 1) {
      throw new BadRequestError(
        'Cannot remove the last admin of the household',
        ErrorCode.LAST_ADMIN,
      );
    }
  }

  await prisma.householdMember.update({
    where: { id: member.id },
    data: { leftAt: new Date() },
  });
};

export const changeMemberRole = async (
  householdId: string,
  targetUserId: string,
  role: MemberRole,
): Promise<MemberDto> => {
  const member = await prisma.householdMember.findFirst({
    where: { householdId, userId: targetUserId, leftAt: null },
    include: { user: true },
  });
  if (!member) {
    throw new NotFoundError('The user is not a member of the household', ErrorCode.NOT_A_MEMBER);
  }

  if (member.role === 'admin' && role === 'member') {
    const adminCount = await prisma.householdMember.count({
      where: { householdId, role: 'admin', leftAt: null },
    });
    if (adminCount <= 1) {
      throw new BadRequestError(
        'Cannot leave the household without an admin',
        ErrorCode.LAST_ADMIN,
      );
    }
  }

  if (member.role === role) {
    return toMemberDto(member);
  }

  const updated = await prisma.householdMember.update({
    where: { id: member.id },
    data: { role },
    include: { user: true },
  });
  return toMemberDto(updated);
};
