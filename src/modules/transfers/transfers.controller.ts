import { asyncHandler } from '../../shared/utils/asyncHandler.js';
import { routeParam } from '../../shared/utils/request.js';
import * as transfersService from './transfers.service.js';
import type { PaginationQuery } from '../../shared/utils/pagination.js';

export const create = asyncHandler(async (req, res) => {
  const transfer = await transfersService.createTransfer(
    req.user!.id,
    routeParam(req, 'householdId'),
    req.body,
  );
  res.status(201).json(transfer);
});

export const list = asyncHandler(async (req, res) => {
  const query = req.validatedQuery as PaginationQuery;
  res.json(await transfersService.listTransfers(routeParam(req, 'householdId'), query));
});

export const remove = asyncHandler(async (req, res) => {
  await transfersService.voidTransfer(
    routeParam(req, 'householdId'),
    routeParam(req, 'transferId'),
  );
  res.status(204).send();
});
