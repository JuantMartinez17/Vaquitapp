import { Router } from 'express';
import { authMiddleware } from '../../app/middleware/auth.middleware.js';
import { validate } from '../../app/middleware/validate.middleware.js';
import { authRateLimiter } from '../../app/middleware/rate-limit.middleware.js';
import { registerSchema, loginSchema, refreshSchema } from './auth.schema.js';
import * as authController from './auth.controller.js';

export const authRouter = Router();

authRouter.post('/register', authRateLimiter, validate(registerSchema), authController.register);
authRouter.post('/login', authRateLimiter, validate(loginSchema), authController.login);
authRouter.post('/refresh', authRateLimiter, validate(refreshSchema), authController.refresh);
authRouter.post('/logout', validate(refreshSchema), authController.logout);
authRouter.post('/logout-all', authMiddleware, authController.logoutAll);
