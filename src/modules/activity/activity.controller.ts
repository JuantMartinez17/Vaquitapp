import { asyncHandler } from '../../shared/utils/asyncHandler.js';
import { routeParam } from '../../shared/utils/request.js';
import * as activityService from './activity.service.js';
import type { PaginationQuery } from '../../shared/utils/pagination.js';

export const list = asyncHandler(async (req, res) => {
  const query = req.validatedQuery as PaginationQuery;
  res.json(await activityService.getActivity(routeParam(req, 'householdId'), query));
});
