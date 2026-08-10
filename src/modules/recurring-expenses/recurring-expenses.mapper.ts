import type { Prisma } from '../../generated/prisma/client.js';
import { formatMoney } from '../../domain/money/money.js';

export const RECURRING_EXPENSE_INCLUDE = {
  payer: true,
  category: true,
  currency: true,
  splits: { include: { user: true } },
} satisfies Prisma.RecurringExpenseInclude;

export type RecurringExpenseWithRelations = Prisma.RecurringExpenseGetPayload<{
  include: typeof RECURRING_EXPENSE_INCLUDE;
}>;

export interface RecurringExpenseSplitDto {
  userId: string;
  displayName: string | null;
  amount: string | null;
  percentage: string | null;
  shares: number | null;
}

export interface RecurringExpenseDto {
  id: string;
  householdId: string;
  description: string;
  defaultAmount: string;
  currencyCode: string;
  category: { id: string; name: string } | null;
  paidBy: { id: string; displayName: string | null };
  splitType: RecurringExpenseWithRelations['splitType'];
  splits: RecurringExpenseSplitDto[];
  frequency: RecurringExpenseWithRelations['frequency'];
  dayOfMonth: number | null;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  nextRunDate: string;
  lastGeneratedDate: string | null;
}

export const toRecurringExpenseDto = (
  recurring: RecurringExpenseWithRelations,
): RecurringExpenseDto => {
  const decimalPlaces = recurring.currency.decimalPlaces;
  return {
    id: recurring.id,
    householdId: recurring.householdId,
    description: recurring.description,
    defaultAmount: formatMoney(recurring.defaultAmount, decimalPlaces),
    currencyCode: recurring.currencyCode,
    category: recurring.category
      ? { id: recurring.category.id, name: recurring.category.name }
      : null,
    paidBy: { id: recurring.payer.id, displayName: recurring.payer.displayName },
    splitType: recurring.splitType,
    splits: recurring.splits.map((split) => ({
      userId: split.userId,
      displayName: split.user.displayName,
      amount: split.amount ? formatMoney(split.amount, decimalPlaces) : null,
      percentage: split.percentage ? split.percentage.toString() : null,
      shares: split.shares,
    })),
    frequency: recurring.frequency,
    dayOfMonth: recurring.dayOfMonth,
    startDate: recurring.startDate.toISOString().slice(0, 10),
    endDate: recurring.endDate ? recurring.endDate.toISOString().slice(0, 10) : null,
    isActive: recurring.isActive,
    nextRunDate: recurring.nextRunDate.toISOString().slice(0, 10),
    lastGeneratedDate: recurring.lastGeneratedDate
      ? recurring.lastGeneratedDate.toISOString().slice(0, 10)
      : null,
  };
};

export interface UpcomingRecurringExpenseDto {
  id: string;
  description: string;
  defaultAmount: string;
  currencyCode: string;
  nextRunDate: string;
  overdue: boolean;
}

export const toUpcomingDto = (
  recurring: RecurringExpenseWithRelations,
  today: Date,
): UpcomingRecurringExpenseDto => ({
  id: recurring.id,
  description: recurring.description,
  defaultAmount: formatMoney(recurring.defaultAmount, recurring.currency.decimalPlaces),
  currencyCode: recurring.currencyCode,
  nextRunDate: recurring.nextRunDate.toISOString().slice(0, 10),
  overdue: recurring.nextRunDate.getTime() <= today.getTime(),
});
