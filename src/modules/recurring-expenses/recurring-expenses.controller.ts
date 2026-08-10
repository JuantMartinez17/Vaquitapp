import { asyncHandler } from '../../shared/utils/asyncHandler.js';
import { routeParam } from '../../shared/utils/request.js';
import * as recurringExpensesService from './recurring-expenses.service.js';

export const create = asyncHandler(async (req, res) => {
  const recurring = await recurringExpensesService.createRecurringExpense(
    req.user!.id,
    routeParam(req, 'householdId'),
    req.body,
  );
  res.status(201).json(recurring);
});

export const list = asyncHandler(async (req, res) => {
  res.json(await recurringExpensesService.listRecurringExpenses(routeParam(req, 'householdId')));
});

export const upcoming = asyncHandler(async (req, res) => {
  res.json(await recurringExpensesService.getUpcoming(routeParam(req, 'householdId')));
});

export const update = asyncHandler(async (req, res) => {
  const recurring = await recurringExpensesService.updateRecurringExpense(
    routeParam(req, 'householdId'),
    routeParam(req, 'recurringExpenseId'),
    req.body,
  );
  res.json(recurring);
});

export const remove = asyncHandler(async (req, res) => {
  await recurringExpensesService.deleteRecurringExpense(
    routeParam(req, 'householdId'),
    routeParam(req, 'recurringExpenseId'),
  );
  res.status(204).send();
});
