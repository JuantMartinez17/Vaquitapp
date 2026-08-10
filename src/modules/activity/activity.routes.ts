import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../app/middleware/auth.middleware.js';
import { requireHouseholdMember } from '../../app/middleware/authorization.middleware.js';
import { validate } from '../../app/middleware/validate.middleware.js';
import { paginationQuerySchema } from '../../shared/utils/pagination.js';
import * as activityController from './activity.controller.js';

const householdIdParam = {
  params: z.object({ householdId: z.string().uuid() }),
  query: paginationQuerySchema,
};

/**
 * Mounted at `/households/:householdId/activity` with `{ mergeParams: true }`
 * so `requireHouseholdMember` can read the parent path's `:householdId`.
 */
export const activityRouter = Router({ mergeParams: true });
activityRouter.use(authMiddleware);

activityRouter.get(
  '/',
  validate(householdIdParam),
  requireHouseholdMember(),
  activityController.list,
);
