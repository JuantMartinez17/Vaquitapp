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
import {
  assertHouseholdActive,
  assertActiveMembers,
  lockHouseholdShared,
} from '../households/households.service.js';
import { TRANSFER_INCLUDE, toTransferDto } from './transfers.mapper.js';
import type { TransferDto } from './transfers.mapper.js';
import type { CreateTransferDto, ListTransfersQuery } from './transfers.schema.js';
import type { MemberRole } from '../../generated/prisma/client.js';

export const createTransfer = async (
  requestingUserId: string,
  householdId: string,
  dto: CreateTransferDto,
): Promise<TransferDto> => {
  if (dto.fromUser === dto.toUser) {
    throw new ValidationError('fromUser and toUser must be different', ErrorCode.INVALID_TRANSFER);
  }
  // Same rule as settlements: only a party to the transfer can record it.
  if (requestingUserId !== dto.fromUser && requestingUserId !== dto.toUser) {
    throw new ForbiddenError('You can only record a transfer you are a party to');
  }

  // One transaction from the lock to the insert, so the parties and currency
  // checked here are still the household's when the transfer lands.
  const transfer = await prisma.$transaction(async (tx) => {
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
      ErrorCode.INVALID_TRANSFER,
      tx,
    );

    const currency = await tx.currency.findUniqueOrThrow({ where: { code: dto.currencyCode } });
    const amount = roundToCurrency(dto.amount, currency.decimalPlaces);
    if (amount.lte(0)) {
      throw new ValidationError('Amount must be greater than zero', ErrorCode.INVALID_TRANSFER);
    }

    return tx.transfer.create({
      data: {
        householdId,
        fromUser: dto.fromUser,
        toUser: dto.toUser,
        amount: amount.toFixed(currency.decimalPlaces),
        currencyCode: dto.currencyCode,
        transferDate: new Date(dto.transferDate),
        notes: dto.notes ?? null,
        createdBy: requestingUserId,
      },
      include: TRANSFER_INCLUDE,
    });
  });
  return toTransferDto(transfer);
};

export const getTransfer = async (
  householdId: string,
  transferId: string,
): Promise<TransferDto> => {
  const transfer = await prisma.transfer.findFirst({
    where: { id: transferId, householdId },
    include: TRANSFER_INCLUDE,
  });
  if (!transfer) {
    throw new NotFoundError('Transfer not found');
  }
  return toTransferDto(transfer);
};

export const listTransfers = async (
  householdId: string,
  query: ListTransfersQuery,
): Promise<Page<TransferDto>> => {
  const { take, cursor } = parsePagination(query);
  const rows = await prisma.transfer.findMany({
    where: { householdId, ...(query.includeVoided === 'true' ? {} : { voidedAt: null }) },
    include: TRANSFER_INCLUDE,
    orderBy: [{ transferDate: 'desc' }, { id: 'desc' }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const page = buildPage(rows, take);
  return { data: page.data.map(toTransferDto), nextCursor: page.nextCursor };
};

export const voidTransfer = async (
  actor: { userId: string; role: MemberRole },
  householdId: string,
  transferId: string,
): Promise<void> => {
  const transfer = await prisma.transfer.findFirst({ where: { id: transferId, householdId } });
  if (!transfer) {
    throw new NotFoundError('Transfer not found');
  }
  // Same rule as recording one (see createTransfer), with admins added as a
  // safety valve: otherwise a transfer entered by mistake could be stuck if
  // its parties are unavailable or have left.
  const isParty = actor.userId === transfer.fromUser || actor.userId === transfer.toUser;
  if (!isParty && actor.role !== 'admin') {
    throw new ForbiddenError('Only a party to the transfer or a household admin can void it');
  }

  // Conditional on the transfer still being active, so of two racing voids
  // exactly one matches and the other reports the same conflict as a retry.
  const voided = await prisma.transfer.updateMany({
    where: { id: transferId, householdId, voidedAt: null },
    data: { voidedAt: new Date() },
  });
  if (voided.count === 0) {
    throw new ConflictError('Transfer was already voided', ErrorCode.TRANSFER_ALREADY_VOIDED);
  }
};
