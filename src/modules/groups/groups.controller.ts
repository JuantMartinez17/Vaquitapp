import { asyncHandler } from '../../utils/asyncHandler.js';
import { routeParam } from '../../utils/request.js';
import * as groupsService from './groups.service.js';

export const create = asyncHandler(async (req, res) => {
  res.status(201).json(await groupsService.createGroup(req.user!.id, req.body));
});

export const listMine = asyncHandler(async (req, res) => {
  res.json(await groupsService.listGroupsForUser(req.user!.id));
});

export const getOne = asyncHandler(async (req, res) => {
  res.json(await groupsService.getGroup(routeParam(req, 'groupId'), req.membership!.role));
});

export const update = asyncHandler(async (req, res) => {
  res.json(await groupsService.updateGroup(routeParam(req, 'groupId'), req.body));
});

export const remove = asyncHandler(async (req, res) => {
  await groupsService.softDeleteGroup(routeParam(req, 'groupId'));
  res.status(204).send();
});

export const listMembers = asyncHandler(async (req, res) => {
  res.json(await groupsService.listMembers(routeParam(req, 'groupId')));
});

export const addMember = asyncHandler(async (req, res) => {
  const member = await groupsService.addMember(
    routeParam(req, 'groupId'),
    req.body.email,
    req.body.role ?? 'member',
  );
  res.status(201).json(member);
});

export const removeMember = asyncHandler(async (req, res) => {
  await groupsService.removeMember(routeParam(req, 'groupId'), routeParam(req, 'userId'));
  res.status(204).send();
});

export const updateMemberRole = asyncHandler(async (req, res) => {
  res.json(
    await groupsService.changeMemberRole(
      routeParam(req, 'groupId'),
      routeParam(req, 'userId'),
      req.body.role,
    ),
  );
});
