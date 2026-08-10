import { asyncHandler } from '../../shared/utils/asyncHandler.js';
import { routeParam } from '../../shared/utils/request.js';
import * as incomesService from './incomes.service.js';
import type { PaginationQuery } from '../../shared/utils/pagination.js';

export const create = asyncHandler(async (req, res) => {
  const income = await incomesService.createIncome(
    req.user!.id,
    routeParam(req, 'householdId'),
    req.body,
  );
  res.status(201).json(income);
});

export const list = asyncHandler(async (req, res) => {
  const query = req.validatedQuery as PaginationQuery;
  res.json(await incomesService.listIncomes(routeParam(req, 'householdId'), query));
});

export const update = asyncHandler(async (req, res) => {
  const income = await incomesService.updateIncome(
    routeParam(req, 'householdId'),
    routeParam(req, 'incomeId'),
    req.body,
  );
  res.json(income);
});

export const remove = asyncHandler(async (req, res) => {
  await incomesService.voidIncome(routeParam(req, 'householdId'), routeParam(req, 'incomeId'));
  res.status(204).send();
});
