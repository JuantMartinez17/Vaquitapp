import { asyncHandler } from '../../shared/utils/asyncHandler.js';
import { toUserDto } from './users.mapper.js';
import * as usersService from './users.service.js';
import * as invitationsService from '../invitations/invitations.service.js';

export const getMe = asyncHandler(async (req, res) => {
  const user = await usersService.getUserById(req.user!.id);
  res.json(toUserDto(user));
});

export const updateMe = asyncHandler(async (req, res) => {
  const user = await usersService.updateUser(req.user!.id, req.body);
  res.json(toUserDto(user));
});

export const listMyInvitations = asyncHandler(async (req, res) => {
  res.json(await invitationsService.listMyInvitations(req.user!.email));
});
