import { asyncHandler } from '../../shared/utils/asyncHandler.js';
import { routeParam } from '../../shared/utils/request.js';
import * as analyticsService from './analytics.service.js';
import type { DateRangeQuery, OverTimeQuery } from './analytics.schema.js';

export const summary = asyncHandler(async (req, res) => {
  const query = req.validatedQuery as DateRangeQuery;
  res.json(await analyticsService.getSummary(routeParam(req, 'householdId'), query));
});

export const byCategory = asyncHandler(async (req, res) => {
  const query = req.validatedQuery as DateRangeQuery;
  res.json(await analyticsService.getByCategory(routeParam(req, 'householdId'), query));
});

export const byMember = asyncHandler(async (req, res) => {
  const query = req.validatedQuery as DateRangeQuery;
  res.json(await analyticsService.getByMember(routeParam(req, 'householdId'), query));
});

export const overTime = asyncHandler(async (req, res) => {
  const query = req.validatedQuery as OverTimeQuery;
  res.json(await analyticsService.getOverTime(routeParam(req, 'householdId'), query));
});

export const comparison = asyncHandler(async (req, res) => {
  const query = req.validatedQuery as DateRangeQuery;
  res.json(await analyticsService.getComparison(routeParam(req, 'householdId'), query));
});
