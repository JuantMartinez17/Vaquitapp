import { asyncHandler } from '../../shared/utils/asyncHandler.js';
import { routeParam } from '../../shared/utils/request.js';
import * as categoriesService from './categories.service.js';

export const listGlobal = asyncHandler(async (_req, res) => {
  res.json(await categoriesService.listGlobalCategories());
});

export const listForHousehold = asyncHandler(async (req, res) => {
  res.json(await categoriesService.listHouseholdCategories(routeParam(req, 'householdId')));
});

export const create = asyncHandler(async (req, res) => {
  const category = await categoriesService.createCategory(routeParam(req, 'householdId'), req.body);
  res.status(201).json(category);
});

export const update = asyncHandler(async (req, res) => {
  const category = await categoriesService.updateCategory(
    routeParam(req, 'householdId'),
    routeParam(req, 'categoryId'),
    req.body,
  );
  res.json(category);
});

export const remove = asyncHandler(async (req, res) => {
  await categoriesService.deleteCategory(
    routeParam(req, 'householdId'),
    routeParam(req, 'categoryId'),
  );
  res.status(204).send();
});
