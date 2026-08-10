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
import type { Page, PaginationQuery } from '../../shared/utils/pagination.js';
import { assertHouseholdActive, assertActiveMembers } from '../households/households.service.js';
import { TRANSFER_INCLUDE, toTransferDto } from './transfers.mapper.js';
import type { TransferDto } from './transfers.mapper.js';
import type { CreateTransferDto } from './transfers.schema.js';

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

  const household = await assertHouseholdActive(householdId);
  if (dto.currencyCode !== household.defaultCurrencyCode) {
    throw new ValidationError(
      `Currency must match the household's currency (${household.defaultCurrencyCode})`,
      ErrorCode.INVALID_CURRENCY,
    );
  }
  await assertActiveMembers(householdId, [dto.fromUser, dto.toUser], ErrorCode.INVALID_TRANSFER);

  const currency = await prisma.currency.findUniqueOrThrow({ where: { code: dto.currencyCode } });
  const amount = roundToCurrency(dto.amount, currency.decimalPlaces);
  if (amount.lte(0)) {
    throw new ValidationError('Amount must be greater than zero', ErrorCode.INVALID_TRANSFER);
  }

  const transfer = await prisma.transfer.create({
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
  return toTransferDto(transfer);
};

export const listTransfers = async (
  householdId: string,
  query: PaginationQuery,
): Promise<Page<TransferDto>> => {
  const { take, cursor } = parsePagination(query);
  const rows = await prisma.transfer.findMany({
    where: { householdId },
    include: TRANSFER_INCLUDE,
    orderBy: [{ transferDate: 'desc' }, { id: 'desc' }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const page = buildPage(rows, take);
  return { data: page.data.map(toTransferDto), nextCursor: page.nextCursor };
};

export const voidTransfer = async (householdId: string, transferId: string): Promise<void> => {
  const transfer = await prisma.transfer.findFirst({ where: { id: transferId, householdId } });
  if (!transfer) {
    throw new NotFoundError('Transfer not found');
  }
  if (transfer.voidedAt) {
    throw new ConflictError('Transfer was already voided', ErrorCode.TRANSFER_ALREADY_VOIDED);
  }
  await prisma.transfer.update({ where: { id: transferId }, data: { voidedAt: new Date() } });
};
