import type { Prisma } from '../../generated/prisma/client.js';
import { formatMoney } from '../../domain/money/money.js';

export const EXPENSE_INCLUDE = {
  payer: true,
  category: true,
  currency: true,
  splits: { include: { user: true } },
} satisfies Prisma.ExpenseInclude;

export type ExpenseWithRelations = Prisma.ExpenseGetPayload<{ include: typeof EXPENSE_INCLUDE }>;

export interface ExpenseSplitDto {
  userId: string;
  displayName: string | null;
  amount: string;
  percentage: string | null;
  shares: number | null;
}

export interface ExpenseDto {
  id: string;
  householdId: string;
  description: string;
  notes: string | null;
  amount: string;
  currencyCode: string;
  expenseDate: string;
  status: ExpenseWithRelations['status'];
  splitType: ExpenseWithRelations['splitType'];
  paidBy: { id: string; displayName: string | null };
  category: { id: string; name: string } | null;
  splits: ExpenseSplitDto[];
  createdAt: string;
  updatedAt: string;
}

export const toExpenseDto = (expense: ExpenseWithRelations): ExpenseDto => {
  const decimalPlaces = expense.currency.decimalPlaces;
  return {
    id: expense.id,
    householdId: expense.householdId,
    description: expense.description,
    notes: expense.notes,
    amount: formatMoney(expense.amount, decimalPlaces),
    currencyCode: expense.currencyCode,
    expenseDate: expense.expenseDate.toISOString().slice(0, 10),
    status: expense.status,
    splitType: expense.splitType,
    paidBy: { id: expense.payer.id, displayName: expense.payer.displayName },
    category: expense.category ? { id: expense.category.id, name: expense.category.name } : null,
    splits: expense.splits.map((split) => ({
      userId: split.userId,
      displayName: split.user.displayName,
      amount: formatMoney(split.amount, decimalPlaces),
      percentage: split.percentage ? split.percentage.toString() : null,
      shares: split.shares,
    })),
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
  };
};
