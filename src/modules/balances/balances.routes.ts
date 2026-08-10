import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../app/middleware/auth.middleware.js';
import { requireHouseholdMember } from '../../app/middleware/authorization.middleware.js';
import { validate } from '../../app/middleware/validate.middleware.js';
import * as balancesController from './balances.controller.js';

const householdIdParam = {
  params: z.object({ householdId: z.string().uuid() }),
};

/**
 * Read-only, mounted at `/households/:householdId/balances` with
 * `{ mergeParams: true }` so `requireHouseholdMember` can read the parent
 * path's `:householdId`.
 */
export const balancesRouter = Router({ mergeParams: true });
balancesRouter.use(authMiddleware);

balancesRouter.get(
  '/',
  validate(householdIdParam),
  requireHouseholdMember(),
  balancesController.getBalances,
);
balancesRouter.get(
  '/simplified',
  validate(householdIdParam),
  requireHouseholdMember(),
  balancesController.getSimplified,
);
