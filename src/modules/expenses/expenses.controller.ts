import { asyncHandler } from '../../shared/utils/asyncHandler.js';
import { routeParam } from '../../shared/utils/request.js';
import * as expensesService from './expenses.service.js';
import type { ListExpensesQuery } from './expenses.schema.js';

export const create = asyncHandler(async (req, res) => {
  const expense = await expensesService.createExpense(
    req.user!.id,
    routeParam(req, 'householdId'),
    req.body,
  );
  res.status(201).json(expense);
});

export const list = asyncHandler(async (req, res) => {
  const query = req.validatedQuery as ListExpensesQuery;
  res.json(await expensesService.listExpenses(routeParam(req, 'householdId'), query));
});

export const getOne = asyncHandler(async (req, res) => {
  res.json(
    await expensesService.getExpense(routeParam(req, 'householdId'), routeParam(req, 'expenseId')),
  );
});

export const update = asyncHandler(async (req, res) => {
  const expense = await expensesService.updateExpense(
    routeParam(req, 'householdId'),
    routeParam(req, 'expenseId'),
    req.body,
  );
  res.json(expense);
});

export const remove = asyncHandler(async (req, res) => {
  await expensesService.voidExpense(routeParam(req, 'householdId'), routeParam(req, 'expenseId'));
  res.status(204).send();
});
