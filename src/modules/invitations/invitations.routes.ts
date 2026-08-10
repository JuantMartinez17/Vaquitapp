import { Router } from 'express';
import { authMiddleware } from '../../app/middleware/auth.middleware.js';
import { requireHouseholdMember } from '../../app/middleware/authorization.middleware.js';
import { validate } from '../../app/middleware/validate.middleware.js';
import {
  createInvitationSchema,
  householdIdParam,
  invitationIdParam,
  tokenSchema,
} from './invitations.schema.js';
import * as invitationsController from './invitations.controller.js';

/**
 * Household-scoped invitation management. Mounted at
 * `/households/:householdId/invitations` with `{ mergeParams: true }` so
 * `requireHouseholdMember` can read `:householdId` from the parent path.
 */
export const householdInvitationsRouter = Router({ mergeParams: true });

householdInvitationsRouter.use(authMiddleware);

householdInvitationsRouter.post(
  '/',
  validate(createInvitationSchema),
  requireHouseholdMember('admin'),
  invitationsController.create,
);
householdInvitationsRouter.get(
  '/',
  validate(householdIdParam),
  requireHouseholdMember('admin'),
  invitationsController.list,
);
householdInvitationsRouter.delete(
  '/:invitationId',
  validate(invitationIdParam),
  requireHouseholdMember('admin'),
  invitationsController.revoke,
);

/**
 * Token-based resolution, not household-scoped: the invitee isn't a member
 * yet, so `requireHouseholdMember` doesn't apply. Mounted at `/invitations`.
 */
export const invitationsRouter = Router();

invitationsRouter.use(authMiddleware);

invitationsRouter.post('/:token/accept', validate(tokenSchema), invitationsController.accept);
invitationsRouter.post('/:token/reject', validate(tokenSchema), invitationsController.reject);
