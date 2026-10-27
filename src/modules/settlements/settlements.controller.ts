import { asyncHandler } from '../../shared/utils/asyncHandler.js';
import { routeParam } from '../../shared/utils/request.js';
import * as settlementsService from './settlements.service.js';
import type { ListSettlementsQuery } from './settlements.schema.js';

export const create = asyncHandler(async (req, res) => {
  const settlement = await settlementsService.createSettlement(
    req.user!.id,
    routeParam(req, 'householdId'),
    req.body,
  );
  res.status(201).json(settlement);
});

export const list = asyncHandler(async (req, res) => {
  const query = req.validatedQuery as ListSettlementsQuery;
  res.json(await settlementsService.listSettlements(routeParam(req, 'householdId'), query));
});

export const getOne = asyncHandler(async (req, res) => {
  res.json(
    await settlementsService.getSettlement(
      routeParam(req, 'householdId'),
      routeParam(req, 'settlementId'),
    ),
  );
});

export const remove = asyncHandler(async (req, res) => {
  await settlementsService.voidSettlement(
    { userId: req.user!.id, role: req.membership!.role },
    routeParam(req, 'householdId'),
    routeParam(req, 'settlementId'),
  );
  res.status(204).send();
});
