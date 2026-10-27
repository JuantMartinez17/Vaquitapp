import { registerSchema, loginSchema, refreshSchema } from '../../../modules/auth/auth.schema.js';
import { updateUserSchema } from '../../../modules/users/users.schema.js';
import type { RouteSpec } from '../openapi.builder.js';
import { AuthSession, InvitationList, TokenPair, User } from '../response-schemas.js';

export const authRoutes: RouteSpec[] = [
  {
    operationId: 'registerUser',
    method: 'post',
    path: '/auth/register',
    tag: 'Auth',
    summary: 'Register a new user',
    description:
      'Creates the account and signs it in. `email` is stored lower-cased. `username` is 3 to 50 ' +
      'letters, digits or underscores. `password` is at least 8 characters and at most 72 bytes ' +
      'in UTF-8. `preferredCurrencyCode` defaults to ARS and must be a supported currency (see ' +
      '`listCurrencies`). Rate limited per IP.',
    auth: false,
    request: registerSchema,
    success: {
      status: 201,
      description: 'User created; returns the user and a token pair',
      schema: AuthSession,
    },
    errors: {
      400: ['BAD_REQUEST'],
      409: ['EMAIL_ALREADY_REGISTERED', 'USERNAME_TAKEN'],
    },
  },
  {
    operationId: 'loginUser',
    method: 'post',
    path: '/auth/login',
    tag: 'Auth',
    summary: 'Log in with email and password',
    description:
      'Returns the user and a fresh token pair. Only **failed** attempts count against the login ' +
      'rate limit. The error never reveals whether the email or the password was wrong.',
    auth: false,
    request: loginSchema,
    success: {
      status: 200,
      description: 'Returns the user and a token pair',
      schema: AuthSession,
    },
    errors: { 401: ['INVALID_CREDENTIALS'] },
  },
  {
    operationId: 'refreshTokens',
    method: 'post',
    path: '/auth/refresh',
    tag: 'Auth',
    summary: 'Rotate a refresh token',
    description:
      'Exchanges a refresh token for a new access token and a **new refresh token**; the presented ' +
      'one is revoked. Presenting an already-used (or concurrently used) refresh token revokes ' +
      'every session of the user and answers `TOKEN_REUSE_DETECTED`. Do not send two refreshes ' +
      'with the same token at the same time.',
    auth: false,
    request: refreshSchema,
    success: {
      status: 200,
      description: 'Returns a new token pair; the old refresh token is revoked',
      schema: TokenPair,
    },
    errors: { 401: ['UNAUTHORIZED', 'TOKEN_REUSE_DETECTED'] },
  },
  {
    operationId: 'logout',
    method: 'post',
    path: '/auth/logout',
    tag: 'Auth',
    summary: 'Revoke a refresh token',
    description:
      'Ends the current session by revoking the given refresh token. Always succeeds, also for an ' +
      'unknown or already revoked token, so it is safe to retry.',
    auth: false,
    request: refreshSchema,
    success: { status: 204, description: 'Refresh token revoked' },
  },
  {
    operationId: 'logoutAll',
    method: 'post',
    path: '/auth/logout-all',
    tag: 'Auth',
    summary: 'Revoke every session for the current user',
    description:
      'Revokes all refresh tokens of the user, signing them out of every device. Access tokens ' +
      'already issued keep working until they expire (at most 15 minutes).',
    success: { status: 204, description: 'All refresh tokens for the user revoked' },
  },

  {
    operationId: 'getCurrentUser',
    method: 'get',
    path: '/users/me',
    tag: 'Users',
    summary: "Get the current user's profile",
    description: 'The profile of the user the access token belongs to.',
    success: { status: 200, description: 'Current user', schema: User },
    errors: { 404: ['NOT_FOUND'] },
  },
  {
    operationId: 'updateCurrentUser',
    method: 'patch',
    path: '/users/me',
    tag: 'Users',
    summary: "Update the current user's profile",
    description:
      'Partial update: send only the fields to change. `avatarUrl` must be an http(s) URL. ' +
      '`preferredCurrencyCode` must be a supported currency. It is only the default suggested for ' +
      'the user: each household keeps its own currency.',
    request: updateUserSchema,
    success: { status: 200, description: 'Updated user', schema: User },
    errors: { 400: ['BAD_REQUEST'], 404: ['NOT_FOUND'] },
  },
  {
    operationId: 'listMyInvitations',
    method: 'get',
    path: '/users/me/invitations',
    tag: 'Users',
    summary: "List the current user's pending invitations",
    description:
      'Invitations addressed to the email of the user that are still `pending` and not expired, ' +
      'newest first. Use the invitation `token` shared by the inviter to accept or reject; this ' +
      'list does not include tokens.',
    success: {
      status: 200,
      description: 'Pending invitations',
      schema: InvitationList,
    },
  },
];
