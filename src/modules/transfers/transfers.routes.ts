import { Router } from 'express';
import { authMiddleware } from '../../app/middleware/auth.middleware.js';
import { requireHouseholdMember } from '../../app/middleware/authorization.middleware.js';
import { validate } from '../../app/middleware/validate.middleware.js';
import {
  householdIdParam,
  createTransferSchema,
  transferIdParam,
  listTransfersQuerySchema,
} from './transfers.schema.js';
import * as transfersController from './transfers.controller.js';

/**
 * Mounted at `/households/:householdId/transfers` with `{ mergeParams: true }`
 * so `requireHouseholdMember` can read the parent path's `:householdId`.
 */
export const transfersRouter = Router({ mergeParams: true });
transfersRouter.use(authMiddleware);

transfersRouter.post(
  '/',
  validate(createTransferSchema),
  requireHouseholdMember(),
  transfersController.create,
);
transfersRouter.get(
  '/',
  validate({ params: householdIdParam.params, query: listTransfersQuerySchema }),
  requireHouseholdMember(),
  transfersController.list,
);
transfersRouter.delete(
  '/:transferId',
  validate(transferIdParam),
  requireHouseholdMember(),
  transfersController.remove,
);
