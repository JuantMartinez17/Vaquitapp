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
import { SETTLEMENT_INCLUDE, toSettlementDto } from './settlements.mapper.js';
import type { SettlementDto } from './settlements.mapper.js';
import type { CreateSettlementDto, ListSettlementsQuery } from './settlements.schema.js';
import type { MemberRole } from '../../generated/prisma/client.js';
import {
  assertHouseholdActive,
  assertActiveMembers,
  lockHouseholdShared,
} from '../households/households.service.js';

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

  // One transaction from the lock to the insert, so the parties and currency
  // checked here are still the household's when the settlement lands.
  const settlement = await prisma.$transaction(async (tx) => {
    await lockHouseholdShared(tx, householdId);

    const household = await assertHouseholdActive(householdId, tx);
    if (dto.currencyCode !== household.defaultCurrencyCode) {
      throw new ValidationError(
        `Currency must match the household's currency (${household.defaultCurrencyCode})`,
        ErrorCode.INVALID_CURRENCY,
      );
    }

    await assertActiveMembers(
      householdId,
      [dto.fromUser, dto.toUser],
      ErrorCode.INVALID_SETTLEMENT,
      tx,
    );

    const currency = await tx.currency.findUniqueOrThrow({ where: { code: dto.currencyCode } });
    const amount = roundToCurrency(dto.amount, currency.decimalPlaces);
    if (amount.lte(0)) {
      throw new ValidationError('Amount must be greater than zero', ErrorCode.INVALID_SETTLEMENT);
    }

    return tx.settlement.create({
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
  });
  return toSettlementDto(settlement);
};

export const getSettlement = async (
  householdId: string,
  settlementId: string,
): Promise<SettlementDto> => {
  const settlement = await prisma.settlement.findFirst({
    where: { id: settlementId, householdId },
    include: SETTLEMENT_INCLUDE,
  });
  if (!settlement) {
    throw new NotFoundError('Settlement not found');
  }
  return toSettlementDto(settlement);
};

export const listSettlements = async (
  householdId: string,
  query: ListSettlementsQuery,
): Promise<Page<SettlementDto>> => {
  const { take, cursor } = parsePagination(query);
  const rows = await prisma.settlement.findMany({
    where: {
      householdId,
      ...(query.includeVoided === 'true' ? {} : { status: { not: 'voided' } }),
    },
    include: SETTLEMENT_INCLUDE,
    orderBy: [{ settlementDate: 'desc' }, { id: 'desc' }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const page = buildPage(rows, take);
  return { data: page.data.map(toSettlementDto), nextCursor: page.nextCursor };
};

export const voidSettlement = async (
  actor: { userId: string; role: MemberRole },
  householdId: string,
  settlementId: string,
): Promise<void> => {
  const settlement = await prisma.settlement.findFirst({
    where: { id: settlementId, householdId },
  });
  if (!settlement) {
    throw new NotFoundError('Settlement not found');
  }
  // Same rule as recording one (see createSettlement), with admins added as a
  // safety valve: otherwise a settlement entered by mistake could be stuck if
  // its parties are unavailable or have left.
  const isParty = actor.userId === settlement.fromUser || actor.userId === settlement.toUser;
  if (!isParty && actor.role !== 'admin') {
    throw new ForbiddenError('Only a party to the settlement or a household admin can void it');
  }

  // Conditional on the status the read above saw, so of two racing voids
  // exactly one matches and the other reports the same conflict as a retry.
  const voided = await prisma.settlement.updateMany({
    where: { id: settlementId, householdId, status: { not: 'voided' } },
    data: { status: 'voided', voidedAt: new Date() },
  });
  if (voided.count === 0) {
    throw new ConflictError('Settlement was already voided', ErrorCode.SETTLEMENT_ALREADY_VOIDED);
  }
};
