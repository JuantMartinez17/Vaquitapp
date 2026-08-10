import { prisma } from '../../infrastructure/database/prisma.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/errors.js';
import { ErrorCode } from '../../shared/errors/codes.js';
import { roundToCurrency } from '../../domain/money/money.js';
import { parsePagination, buildPage } from '../../shared/utils/pagination.js';
import type { Page } from '../../shared/utils/pagination.js';
import type { PaginationQuery } from '../../shared/utils/pagination.js';
import { SETTLEMENT_INCLUDE, toSettlementDto } from './settlements.mapper.js';
import type { SettlementDto } from './settlements.mapper.js';
import type { CreateSettlementDto } from './settlements.schema.js';

const loadActiveHousehold = async (householdId: string) => {
  const household = await prisma.household.findFirst({
    where: { id: householdId, deletedAt: null },
  });
  if (!household) {
    throw new NotFoundError('Household not found', ErrorCode.HOUSEHOLD_NOT_FOUND);
  }
  return household;
};

const assertActiveMembers = async (householdId: string, userIds: string[]): Promise<void> => {
  const uniqueIds = [...new Set(userIds)];
  const count = await prisma.householdMember.count({
    where: { householdId, userId: { in: uniqueIds }, leftAt: null },
  });
  if (count !== uniqueIds.length) {
    throw new ValidationError(
      'Both parties must be active members of this household',
      ErrorCode.INVALID_SETTLEMENT,
    );
  }
};

export const createSettlement = async (
  requestingUserId: string,
  householdId: string,
  dto: CreateSettlementDto,
): Promise<SettlementDto> => {
  if (dto.fromUser === dto.toUser) {
    throw new ValidationError(
      'fromUser and toUser must be different',
      ErrorCode.INVALID_SETTLEMENT,
    );
  }
  // A member can only record a settlement they are a party to — otherwise
  // anyone could unilaterally declare someone else's debt resolved.
  if (requestingUserId !== dto.fromUser && requestingUserId !== dto.toUser) {
    throw new ForbiddenError('You can only record a settlement you are a party to');
  }

  const household = await loadActiveHousehold(householdId);
  if (dto.currencyCode !== household.defaultCurrencyCode) {
    throw new ValidationError(
      `Currency must match the household's currency (${household.defaultCurrencyCode})`,
      ErrorCode.INVALID_CURRENCY,
    );
  }

  await assertActiveMembers(householdId, [dto.fromUser, dto.toUser]);

  const currency = await prisma.currency.findUniqueOrThrow({ where: { code: dto.currencyCode } });
  const amount = roundToCurrency(dto.amount, currency.decimalPlaces);
  if (amount.lte(0)) {
    throw new ValidationError('Amount must be greater than zero', ErrorCode.INVALID_SETTLEMENT);
  }

  const settlement = await prisma.settlement.create({
    data: {
      householdId,
      fromUser: dto.fromUser,
      toUser: dto.toUser,
      amount: amount.toFixed(currency.decimalPlaces),
      currencyCode: dto.currencyCode,
      settlementDate: new Date(dto.settlementDate),
      notes: dto.notes ?? null,
      createdBy: requestingUserId,
    },
    include: SETTLEMENT_INCLUDE,
  });
  return toSettlementDto(settlement);
};

export const listSettlements = async (
  householdId: string,
  query: PaginationQuery,
): Promise<Page<SettlementDto>> => {
  const { take, cursor } = parsePagination(query);
  const rows = await prisma.settlement.findMany({
    where: { householdId },
    include: SETTLEMENT_INCLUDE,
    orderBy: [{ settlementDate: 'desc' }, { id: 'desc' }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const page = buildPage(rows, take);
  return { data: page.data.map(toSettlementDto), nextCursor: page.nextCursor };
};

export const voidSettlement = async (householdId: string, settlementId: string): Promise<void> => {
  const settlement = await prisma.settlement.findFirst({
    where: { id: settlementId, householdId },
  });
  if (!settlement) {
    throw new NotFoundError('Settlement not found');
  }
  if (settlement.status === 'voided') {
    throw new ConflictError('Settlement was already voided', ErrorCode.SETTLEMENT_ALREADY_VOIDED);
  }
  await prisma.settlement.update({
    where: { id: settlementId },
    data: { status: 'voided', voidedAt: new Date() },
  });
};
