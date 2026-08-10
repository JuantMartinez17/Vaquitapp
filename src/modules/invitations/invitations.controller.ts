import { asyncHandler } from '../../shared/utils/asyncHandler.js';
import { routeParam } from '../../shared/utils/request.js';
import * as invitationsService from './invitations.service.js';

export const create = asyncHandler(async (req, res) => {
  const invitation = await invitationsService.createInvitation(
    routeParam(req, 'householdId'),
    req.user!.id,
    req.body.invitedEmail,
  );
  res.status(201).json(invitation);
});

export const list = asyncHandler(async (req, res) => {
  res.json(await invitationsService.listInvitations(routeParam(req, 'householdId')));
});

export const listMine = asyncHandler(async (req, res) => {
  res.json(await invitationsService.listMyInvitations(req.user!.email));
});

export const revoke = asyncHandler(async (req, res) => {
  await invitationsService.revokeInvitation(
    routeParam(req, 'householdId'),
    routeParam(req, 'invitationId'),
  );
  res.status(204).send();
});

export const accept = asyncHandler(async (req, res) => {
  const member = await invitationsService.acceptInvitation(routeParam(req, 'token'), req.user!);
  res.json(member);
});

export const reject = asyncHandler(async (req, res) => {
  await invitationsService.rejectInvitation(routeParam(req, 'token'), req.user!);
  res.status(204).send();
});
