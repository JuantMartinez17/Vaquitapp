import type { Prisma } from '../../generated/prisma/client.js';
import { formatMoney } from '../../domain/money/money.js';

export const INCOME_INCLUDE = {
  receiver: true,
  category: true,
  currency: true,
} satisfies Prisma.IncomeInclude;

export type IncomeWithRelations = Prisma.IncomeGetPayload<{ include: typeof INCOME_INCLUDE }>;

export interface IncomeDto {
  id: string;
  householdId: string;
  receivedBy: { id: string; displayName: string | null };
  description: string;
  notes: string | null;
  amount: string;
  currencyCode: string;
  category: { id: string; name: string } | null;
  incomeDate: string;
  voided: boolean;
  createdAt: string;
}

export const toIncomeDto = (income: IncomeWithRelations): IncomeDto => ({
  id: income.id,
  householdId: income.householdId,
  receivedBy: { id: income.receiver.id, displayName: income.receiver.displayName },
  description: income.description,
  notes: income.notes,
  amount: formatMoney(income.amount, income.currency.decimalPlaces),
  currencyCode: income.currencyCode,
  category: income.category ? { id: income.category.id, name: income.category.name } : null,
  incomeDate: income.incomeDate.toISOString().slice(0, 10),
  voided: income.voidedAt !== null,
  createdAt: income.createdAt.toISOString(),
});
