import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { requireGroupMember } from '../../middlewares/authorization.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import {
  createGroupSchema,
  groupIdParam,
  updateGroupSchema,
  addMemberSchema,
  memberParam,
  updateMemberRoleSchema,
} from './groups.schema.js';
import * as groupsController from './groups.controller.js';

export const groupsRouter = Router();

// Todas las rutas de grupos requieren autenticación.
groupsRouter.use(authMiddleware);

groupsRouter.post('/', validate(createGroupSchema), groupsController.create);
groupsRouter.get('/', groupsController.listMine);

groupsRouter.get(
  '/:groupId',
  validate(groupIdParam),
  requireGroupMember(),
  groupsController.getOne,
);
groupsRouter.patch(
  '/:groupId',
  validate(updateGroupSchema),
  requireGroupMember('admin'),
  groupsController.update,
);
groupsRouter.delete(
  '/:groupId',
  validate(groupIdParam),
  requireGroupMember('admin'),
  groupsController.remove,
);

groupsRouter.get(
  '/:groupId/members',
  validate(groupIdParam),
  requireGroupMember(),
  groupsController.listMembers,
);
groupsRouter.post(
  '/:groupId/members',
  validate(addMemberSchema),
  requireGroupMember('admin'),
  groupsController.addMember,
);
groupsRouter.delete(
  '/:groupId/members/:userId',
  validate(memberParam),
  requireGroupMember('admin'),
  groupsController.removeMember,
);
groupsRouter.patch(
  '/:groupId/members/:userId',
  validate(updateMemberRoleSchema),
  requireGroupMember('admin'),
  groupsController.updateMemberRole,
);
