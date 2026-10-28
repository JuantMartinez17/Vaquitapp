import { Router } from 'express';
import { authMiddleware } from '../../app/middleware/auth.middleware.js';
import { validate } from '../../app/middleware/validate.middleware.js';
import {
  loginRateLimiter,
  refreshRateLimiter,
  registerRateLimiter,
} from '../../app/middleware/rate-limit.middleware.js';
import { registerSchema, loginSchema, refreshSchema } from './auth.schema.js';
import * as authController from './auth.controller.js';

export const authRouter = Router();

authRouter.post(
  '/register',
  registerRateLimiter,
  validate(registerSchema),
  authController.register,
);
authRouter.post('/login', loginRateLimiter, validate(loginSchema), authController.login);
authRouter.post('/refresh', refreshRateLimiter, validate(refreshSchema), authController.refresh);
authRouter.post('/logout', validate(refreshSchema), authController.logout);
authRouter.post('/logout-all', authMiddleware, authController.logoutAll);
