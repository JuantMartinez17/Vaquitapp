import { asyncHandler } from '../../shared/utils/asyncHandler.js';
import { routeParam } from '../../shared/utils/request.js';
import * as householdsService from './households.service.js';

export const create = asyncHandler(async (req, res) => {
  res.status(201).json(await householdsService.createHousehold(req.user!.id, req.body));
});

export const listMine = asyncHandler(async (req, res) => {
  res.json(await householdsService.listHouseholdsForUser(req.user!.id));
});

export const getOne = asyncHandler(async (req, res) => {
  res.json(
    await householdsService.getHousehold(routeParam(req, 'householdId'), req.membership!.role),
  );
});

export const update = asyncHandler(async (req, res) => {
  res.json(await householdsService.updateHousehold(routeParam(req, 'householdId'), req.body));
});

export const remove = asyncHandler(async (req, res) => {
  await householdsService.softDeleteHousehold(routeParam(req, 'householdId'));
  res.status(204).send();
});

export const listMembers = asyncHandler(async (req, res) => {
  res.json(await householdsService.listMembers(routeParam(req, 'householdId')));
});

export const removeMember = asyncHandler(async (req, res) => {
  await householdsService.removeMember(routeParam(req, 'householdId'), routeParam(req, 'userId'));
  res.status(204).send();
});

export const updateMemberRole = asyncHandler(async (req, res) => {
  res.json(
    await householdsService.changeMemberRole(
      routeParam(req, 'householdId'),
      routeParam(req, 'userId'),
      req.body.role,
    ),
  );
});
