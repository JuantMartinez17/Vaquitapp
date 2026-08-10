import { Router } from 'express';
import { authMiddleware } from '../../app/middleware/auth.middleware.js';
import { requireHouseholdMember } from '../../app/middleware/authorization.middleware.js';
import { validate } from '../../app/middleware/validate.middleware.js';
import { idempotent } from '../../app/middleware/idempotency.middleware.js';
import {
  householdIdParam,
  createIncomeSchema,
  updateIncomeSchema,
  incomeIdParam,
  listIncomesQuerySchema,
} from './incomes.schema.js';
import * as incomesController from './incomes.controller.js';

/**
 * Mounted at `/households/:householdId/incomes` with `{ mergeParams: true }`
 * so `requireHouseholdMember` can read the parent path's `:householdId`.
 */
export const incomesRouter = Router({ mergeParams: true });
incomesRouter.use(authMiddleware);

incomesRouter.post(
  '/',
  validate(createIncomeSchema),
  requireHouseholdMember(),
  idempotent('POST /households/:householdId/incomes'),
  incomesController.create,
);
incomesRouter.get(
  '/',
  validate({ params: householdIdParam.params, query: listIncomesQuerySchema }),
  requireHouseholdMember(),
  incomesController.list,
);
incomesRouter.patch(
  '/:incomeId',
  validate(updateIncomeSchema),
  requireHouseholdMember(),
  incomesController.update,
);
incomesRouter.delete(
  '/:incomeId',
  validate(incomeIdParam),
  requireHouseholdMember(),
  incomesController.remove,
);
