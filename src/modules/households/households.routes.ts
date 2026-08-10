import { Router } from 'express';
import { authMiddleware } from '../../app/middleware/auth.middleware.js';
import { requireHouseholdMember } from '../../app/middleware/authorization.middleware.js';
import { validate } from '../../app/middleware/validate.middleware.js';
import {
  createHouseholdSchema,
  householdIdParam,
  updateHouseholdSchema,
  memberParam,
  updateMemberRoleSchema,
} from './households.schema.js';
import * as householdsController from './households.controller.js';

export const householdsRouter = Router();

// Every household route requires authentication.
householdsRouter.use(authMiddleware);

householdsRouter.post('/', validate(createHouseholdSchema), householdsController.create);
householdsRouter.get('/', householdsController.listMine);

householdsRouter.get(
  '/:householdId',
  validate(householdIdParam),
  requireHouseholdMember(),
  householdsController.getOne,
);
householdsRouter.patch(
  '/:householdId',
  validate(updateHouseholdSchema),
  requireHouseholdMember('admin'),
  householdsController.update,
);
householdsRouter.delete(
  '/:householdId',
  validate(householdIdParam),
  requireHouseholdMember('admin'),
  householdsController.remove,
);

householdsRouter.get(
  '/:householdId/members',
  validate(householdIdParam),
  requireHouseholdMember(),
  householdsController.listMembers,
);
householdsRouter.delete(
  '/:householdId/members/:userId',
  validate(memberParam),
  requireHouseholdMember('admin'),
  householdsController.removeMember,
);
householdsRouter.patch(
  '/:householdId/members/:userId',
  validate(updateMemberRoleSchema),
  requireHouseholdMember('admin'),
  householdsController.updateMemberRole,
);
