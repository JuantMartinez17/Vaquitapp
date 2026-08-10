import { Router } from 'express';
import { authMiddleware } from '../../app/middleware/auth.middleware.js';
import { validate } from '../../app/middleware/validate.middleware.js';
import { updateUserSchema } from './users.schema.js';
import * as usersController from './users.controller.js';

export const usersRouter = Router();

// Every user route requires authentication.
usersRouter.use(authMiddleware);

usersRouter.get('/me', usersController.getMe);
usersRouter.patch('/me', validate(updateUserSchema), usersController.updateMe);
usersRouter.get('/me/invitations', usersController.listMyInvitations);
