import { Router } from 'express';
import { authMiddleware } from '../../app/middleware/auth.middleware.js';
import { requireHouseholdMember } from '../../app/middleware/authorization.middleware.js';
import { validate } from '../../app/middleware/validate.middleware.js';
import { dateRangeSchema, overTimeSchema } from './analytics.schema.js';
import * as analyticsController from './analytics.controller.js';

/**
 * Read-only, mounted at `/households/:householdId/analytics` with
 * `{ mergeParams: true }` so `requireHouseholdMember` can read the parent
 * path's `:householdId`. Every route requires an explicit, capped date
 * range (SPECS §27) — there is no unbounded analytics endpoint.
 */
export const analyticsRouter = Router({ mergeParams: true });
analyticsRouter.use(authMiddleware);

analyticsRouter.get(
  '/summary',
  validate(dateRangeSchema),
  requireHouseholdMember(),
  analyticsController.summary,
);
analyticsRouter.get(
  '/by-category',
  validate(dateRangeSchema),
  requireHouseholdMember(),
  analyticsController.byCategory,
);
analyticsRouter.get(
  '/by-member',
  validate(dateRangeSchema),
  requireHouseholdMember(),
  analyticsController.byMember,
);
analyticsRouter.get(
  '/over-time',
  validate(overTimeSchema),
  requireHouseholdMember(),
  analyticsController.overTime,
);
analyticsRouter.get(
  '/comparison',
  validate(dateRangeSchema),
  requireHouseholdMember(),
  analyticsController.comparison,
);
