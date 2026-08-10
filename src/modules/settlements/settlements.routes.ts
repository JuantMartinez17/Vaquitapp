import { Router } from 'express';
import { authMiddleware } from '../../app/middleware/auth.middleware.js';
import { requireHouseholdMember } from '../../app/middleware/authorization.middleware.js';
import { validate } from '../../app/middleware/validate.middleware.js';
import {
  householdIdParam,
  createSettlementSchema,
  settlementIdParam,
  listSettlementsQuerySchema,
} from './settlements.schema.js';
import * as settlementsController from './settlements.controller.js';

/**
 * Mounted at `/households/:householdId/settlements` with
 * `{ mergeParams: true }` so `requireHouseholdMember` can read the parent
 * path's `:householdId`.
 */
export const settlementsRouter = Router({ mergeParams: true });
settlementsRouter.use(authMiddleware);

settlementsRouter.post(
  '/',
  validate(createSettlementSchema),
  requireHouseholdMember(),
  settlementsController.create,
);
settlementsRouter.get(
  '/',
  validate({ params: householdIdParam.params, query: listSettlementsQuerySchema }),
  requireHouseholdMember(),
  settlementsController.list,
);
settlementsRouter.delete(
  '/:settlementId',
  validate(settlementIdParam),
  requireHouseholdMember(),
  settlementsController.remove,
);
