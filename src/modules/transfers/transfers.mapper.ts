import type { Prisma } from '../../generated/prisma/client.js';
import { formatMoney } from '../../domain/money/money.js';

export const TRANSFER_INCLUDE = {
  from: true,
  to: true,
  currency: true,
} satisfies Prisma.TransferInclude;

export type TransferWithRelations = Prisma.TransferGetPayload<{
  include: typeof TRANSFER_INCLUDE;
}>;

export interface TransferDto {
  id: string;
  householdId: string;
  from: { id: string; displayName: string | null };
  to: { id: string; displayName: string | null };
  amount: string;
  currencyCode: string;
  transferDate: string;
  notes: string | null;
  voided: boolean;
  createdAt: string;
}

export const toTransferDto = (transfer: TransferWithRelations): TransferDto => ({
  id: transfer.id,
  householdId: transfer.householdId,
  from: { id: transfer.from.id, displayName: transfer.from.displayName },
  to: { id: transfer.to.id, displayName: transfer.to.displayName },
  amount: formatMoney(transfer.amount, transfer.currency.decimalPlaces),
  currencyCode: transfer.currencyCode,
  transferDate: transfer.transferDate.toISOString().slice(0, 10),
  notes: transfer.notes,
  voided: transfer.voidedAt !== null,
  createdAt: transfer.createdAt.toISOString(),
});
