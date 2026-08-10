import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';

/**
 * Shared setup for API integration tests (Supertest against the Express app,
 * hitting a real database — see CODESTYLE.md §8). Not a test file itself:
 * named without a `.test.ts`/`.itest.ts` suffix so the test runner's glob
 * doesn't try to execute it directly.
 */

// node:test runs separate test files as separate processes, each with its
// own copy of this module — a Date.now()+counter scheme can collide across
// files hitting the same millisecond. A UUID is unique regardless of process.
const unique = (label: string): string => `${label}_${randomUUID().replace(/-/g, '')}`;

export interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

export const registerTestUser = async (
  app: Express,
  overrides?: { email?: string },
): Promise<TestUser> => {
  const email = overrides?.email ?? `${unique('user')}@example.test`;
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({
      email,
      username: unique('user'),
      password: 'Sup3rSecret!',
      displayName: 'Test User',
    })
    .expect(201);
  return { id: res.body.user.id, email: res.body.user.email, accessToken: res.body.accessToken };
};

export const createTestHousehold = async (
  app: Express,
  user: TestUser,
  name = 'Test Household',
): Promise<string> => {
  const res = await request(app)
    .post('/api/v1/households')
    .set('Authorization', `Bearer ${user.accessToken}`)
    .send({ name })
    .expect(201);
  return res.body.id as string;
};

/** Registers a new user and adds them to the household via the invite/accept flow. */
export const addTestMember = async (
  app: Express,
  admin: TestUser,
  householdId: string,
): Promise<TestUser> => {
  const member = await registerTestUser(app);
  const invite = await request(app)
    .post(`/api/v1/households/${householdId}/invitations`)
    .set('Authorization', `Bearer ${admin.accessToken}`)
    .send({ invitedEmail: member.email })
    .expect(201);
  await request(app)
    .post(`/api/v1/invitations/${invite.body.token}/accept`)
    .set('Authorization', `Bearer ${member.accessToken}`)
    .expect(200);
  return member;
};
