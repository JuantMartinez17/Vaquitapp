import { Router } from 'express';
import { authMiddleware } from '../../app/middleware/auth.middleware.js';
import { validate } from '../../app/middleware/validate.middleware.js';
import { registerSchema, loginSchema, refreshSchema } from './auth.schema.js';
import * as authController from './auth.controller.js';

export const authRouter = Router();

authRouter.post('/register', validate(registerSchema), authController.register);
authRouter.post('/login', validate(loginSchema), authController.login);
authRouter.post('/refresh', validate(refreshSchema), authController.refresh);
authRouter.post('/logout', validate(refreshSchema), authController.logout);
authRouter.post('/logout-all', authMiddleware, authController.logoutAll);
