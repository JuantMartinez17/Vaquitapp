import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { updateUserSchema } from './users.schema.js';
import * as usersController from './users.controller.js';

export const usersRouter = Router();

// Todas las rutas de usuarios requieren autenticación.
usersRouter.use(authMiddleware);

usersRouter.get('/me', usersController.getMe);
usersRouter.patch('/me', validate(updateUserSchema), usersController.updateMe);
