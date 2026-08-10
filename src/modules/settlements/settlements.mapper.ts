import type { Prisma } from '../../generated/prisma/client.js';
import { formatMoney } from '../../domain/money/money.js';

export const SETTLEMENT_INCLUDE = {
  from: true,
  to: true,
  currency: true,
} satisfies Prisma.SettlementInclude;

export type SettlementWithRelations = Prisma.SettlementGetPayload<{
  include: typeof SETTLEMENT_INCLUDE;
}>;

export interface SettlementDto {
  id: string;
  householdId: string;
  from: { id: string; displayName: string | null };
  to: { id: string; displayName: string | null };
  amount: string;
  currencyCode: string;
  settlementDate: string;
  notes: string | null;
  status: SettlementWithRelations['status'];
  createdAt: string;
}

export const toSettlementDto = (settlement: SettlementWithRelations): SettlementDto => ({
  id: settlement.id,
  householdId: settlement.householdId,
  from: { id: settlement.from.id, displayName: settlement.from.displayName },
  to: { id: settlement.to.id, displayName: settlement.to.displayName },
  amount: formatMoney(settlement.amount, settlement.currency.decimalPlaces),
  currencyCode: settlement.currencyCode,
  settlementDate: settlement.settlementDate.toISOString().slice(0, 10),
  notes: settlement.notes,
  status: settlement.status,
  createdAt: settlement.createdAt.toISOString(),
});
