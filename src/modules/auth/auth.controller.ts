import type { Request } from 'express';
import { asyncHandler } from '../../shared/utils/asyncHandler.js';
import { toUserDto } from '../users/users.mapper.js';
import * as authService from './auth.service.js';
import type { AuthResult, RequestMeta } from './auth.service.js';

const getMeta = (req: Request): RequestMeta => ({
  userAgent: req.headers['user-agent'],
  ipAddress: req.ip,
});

const authResponse = (result: AuthResult) => ({
  user: toUserDto(result.user),
  accessToken: result.accessToken,
  refreshToken: result.refreshToken,
});

export const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body, getMeta(req));
  res.status(201).json(authResponse(result));
});

export const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body, getMeta(req));
  res.json(authResponse(result));
});

export const refresh = asyncHandler(async (req, res) => {
  const tokens = await authService.refresh(req.body.refreshToken, getMeta(req));
  res.json(tokens);
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.body.refreshToken);
  res.status(204).send();
});

export const logoutAll = asyncHandler(async (req, res) => {
  await authService.logoutAll(req.user!.id);
  res.status(204).send();
});
