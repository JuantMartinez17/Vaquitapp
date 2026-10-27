import {
  createHouseholdSchema,
  householdIdParam,
  updateHouseholdSchema,
  memberParam,
  updateMemberRoleSchema,
} from '../../../modules/households/households.schema.js';
import {
  householdIdParam as invitationsHouseholdIdParam,
  createInvitationSchema,
  invitationIdParam,
  tokenSchema,
} from '../../../modules/invitations/invitations.schema.js';
import type { RouteSpec } from '../openapi.builder.js';
import {
  CreatedInvitation,
  Household,
  HouseholdList,
  InvitationList,
  Member,
  MemberList,
} from '../response-schemas.js';

export const householdsRoutes: RouteSpec[] = [
  {
    operationId: 'createHousehold',
    method: 'post',
    path: '/households',
    tag: 'Households',
    summary: 'Create a household',
    description:
      'Creates a household and makes the caller its first admin. `defaultCurrencyCode` defaults to ' +
      'ARS and must be a supported currency; all amounts in the household use it.',
    request: createHouseholdSchema,
    success: {
      status: 201,
      description: 'Household created; the creator becomes admin',
      schema: Household,
    },
    errors: { 400: ['BAD_REQUEST'] },
  },
  {
    operationId: 'listHouseholds',
    method: 'get',
    path: '/households',
    tag: 'Households',
    summary: 'List the households the current user belongs to',
    description:
      'Active memberships only, most recently joined first. Each item carries the caller `role` and ' +
      'the `memberCount`.',
    success: {
      status: 200,
      description: 'Households with the user’s role and member count',
      schema: HouseholdList,
    },
  },
  {
    operationId: 'getHousehold',
    method: 'get',
    path: '/households/{householdId}',
    tag: 'Households',
    summary: 'Get household detail',
    description: 'Includes the caller `role` and the `memberCount`.',
    request: householdIdParam,
    success: { status: 200, description: 'Household detail', schema: Household },
  },
  {
    operationId: 'updateHousehold',
    method: 'patch',
    path: '/households/{householdId}',
    tag: 'Households',
    summary: 'Update a household',
    description:
      'Partial update of `name`, `description` (nullable) and `defaultCurrencyCode`. Changing the ' +
      'currency is refused with 409 `HOUSEHOLD_CURRENCY_LOCKED` as soon as the household has any ' +
      'financial record (expenses, settlements, incomes, transfers or recurring expenses, voided ' +
      'ones included), because amounts are stored without a conversion. Sending the current ' +
      'currency is always fine. The response omits `role`.',
    role: 'admin',
    request: updateHouseholdSchema,
    success: { status: 200, description: 'Updated household', schema: Household },
    errors: { 400: ['BAD_REQUEST'], 409: ['HOUSEHOLD_CURRENCY_LOCKED'] },
  },
  {
    operationId: 'deleteHousehold',
    method: 'delete',
    path: '/households/{householdId}',
    tag: 'Households',
    summary: 'Delete a household',
    description:
      'Soft delete: the household disappears for every member (their calls then answer 403 ' +
      '`NOT_A_MEMBER`) but its records are kept.',
    role: 'admin',
    request: householdIdParam,
    success: { status: 204, description: 'Household soft-deleted' },
  },
  {
    operationId: 'listMembers',
    method: 'get',
    path: '/households/{householdId}/members',
    tag: 'Households',
    summary: 'List active household members',
    description: 'Members who have not left, oldest first.',
    request: householdIdParam,
    success: { status: 200, description: 'Active members', schema: MemberList },
  },
  {
    operationId: 'leaveHousehold',
    method: 'post',
    path: '/households/{householdId}/members/leave',
    tag: 'Households',
    summary: 'Leave a household',
    description:
      'The caller stops being a member; their past records stay. Refused with 409 ' +
      '`MEMBER_HAS_OPEN_BALANCE` (`details.net` has the amount) while their net balance is not ' +
      'zero: settle up first. Refused with 409 `LAST_ADMIN` if they are the only admin: promote ' +
      'someone else first. After leaving, every household call answers 403 `NOT_A_MEMBER`. They ' +
      'can rejoin with a new invitation.',
    request: householdIdParam,
    success: { status: 204, description: 'The caller left the household' },
    errors: { 409: ['LAST_ADMIN', 'MEMBER_HAS_OPEN_BALANCE'] },
  },
  {
    operationId: 'removeMember',
    method: 'delete',
    path: '/households/{householdId}/members/{userId}',
    tag: 'Households',
    summary: 'Remove a household member',
    description:
      'An admin removes a member (it may be themselves). Same rules as leaving: 409 ' +
      '`MEMBER_HAS_OPEN_BALANCE` while the member has a non-zero net balance, 409 `LAST_ADMIN` ' +
      'for the only admin.',
    role: 'admin',
    request: memberParam,
    success: { status: 204, description: 'Member removed' },
    errors: { 404: ['NOT_A_MEMBER'], 409: ['LAST_ADMIN', 'MEMBER_HAS_OPEN_BALANCE'] },
  },
  {
    operationId: 'updateMemberRole',
    method: 'patch',
    path: '/households/{householdId}/members/{userId}',
    tag: 'Households',
    summary: "Change a member's role",
    description:
      'Promotes to `admin` or demotes to `member`. The last admin cannot be demoted (409 ' +
      '`LAST_ADMIN`). Setting the role a member already has is a no-op that still succeeds.',
    role: 'admin',
    request: updateMemberRoleSchema,
    success: { status: 200, description: 'Updated membership', schema: Member },
    errors: { 404: ['NOT_A_MEMBER'], 409: ['LAST_ADMIN'] },
  },
];

export const invitationsRoutes: RouteSpec[] = [
  {
    operationId: 'createInvitation',
    method: 'post',
    path: '/households/{householdId}/invitations',
    tag: 'Invitations',
    summary: 'Invite a user by email',
    description:
      'Creates an invitation valid for 7 days. The response is the only place the secret `token` ' +
      'appears: share it with the invitee (it goes in the invite link). Only one pending ' +
      'invitation per email and household; an expired one does not block a new one.',
    role: 'admin',
    request: createInvitationSchema,
    success: { status: 201, description: 'Invitation created', schema: CreatedInvitation },
    errors: { 409: ['INVITATION_ALREADY_PENDING'] },
  },
  {
    operationId: 'listInvitations',
    method: 'get',
    path: '/households/{householdId}/invitations',
    tag: 'Invitations',
    summary: 'List household invitations (all statuses)',
    description:
      'Every invitation of the household, newest first, with its status: `pending`, `accepted`, ' +
      '`rejected` or `expired` (a pending one past its deadline is reported as `expired`). Tokens ' +
      'are not included.',
    role: 'admin',
    request: invitationsHouseholdIdParam,
    success: { status: 200, description: 'Invitations', schema: InvitationList },
  },
  {
    operationId: 'revokeInvitation',
    method: 'delete',
    path: '/households/{householdId}/invitations/{invitationId}',
    tag: 'Invitations',
    summary: 'Revoke a pending invitation',
    description:
      'Deletes an invitation that is still `pending` or `expired`, freeing the email for a new ' +
      'one. An already accepted or rejected invitation cannot be revoked.',
    role: 'admin',
    request: invitationIdParam,
    success: { status: 204, description: 'Invitation revoked' },
    errors: { 404: ['INVITATION_NOT_FOUND'], 409: ['INVITATION_ALREADY_RESOLVED'] },
  },
  {
    operationId: 'acceptInvitation',
    method: 'post',
    path: '/invitations/{token}/accept',
    tag: 'Invitations',
    summary: 'Accept an invitation',
    description:
      'Only the user whose email the invitation was sent to can accept it (otherwise 403 ' +
      '`FORBIDDEN`). The caller becomes a `member` of the household; someone who had left is ' +
      'reactivated as a member. The response is the new membership; it does not repeat the ' +
      'household id, so keep the one you got when the invitation was shared.',
    request: tokenSchema,
    success: { status: 200, description: 'Joined the household', schema: Member },
    errors: {
      403: ['FORBIDDEN'],
      404: ['INVITATION_NOT_FOUND'],
      409: ['INVITATION_EXPIRED', 'INVITATION_ALREADY_RESOLVED', 'ALREADY_MEMBER'],
    },
  },
  {
    operationId: 'rejectInvitation',
    method: 'post',
    path: '/invitations/{token}/reject',
    tag: 'Invitations',
    summary: 'Reject an invitation',
    description: 'Only the invited user can reject it. The invitation becomes `rejected`.',
    request: tokenSchema,
    success: { status: 204, description: 'Invitation rejected' },
    errors: {
      403: ['FORBIDDEN'],
      404: ['INVITATION_NOT_FOUND'],
      409: ['INVITATION_EXPIRED', 'INVITATION_ALREADY_RESOLVED'],
    },
  },
];
