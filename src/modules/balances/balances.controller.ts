import { asyncHandler } from '../../shared/utils/asyncHandler.js';
import { routeParam } from '../../shared/utils/request.js';
import * as balancesService from './balances.service.js';

export const getBalances = asyncHandler(async (req, res) => {
  res.json(await balancesService.getBalances(routeParam(req, 'householdId')));
});

export const getSimplified = asyncHandler(async (req, res) => {
  res.json(await balancesService.getSimplifiedBalances(routeParam(req, 'householdId')));
});
