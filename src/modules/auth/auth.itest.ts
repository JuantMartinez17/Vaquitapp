import { randomUUID } from 'node:crypto';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../../app/app.js';
import { prisma } from '../../infrastructure/database/prisma.js';

after(async () => {
  await prisma.$disconnect();
});

const unique = (label: string): string => `${label}_${randomUUID().replace(/-/g, '')}`;

const registerBody = (overrides: Record<string, unknown> = {}) => ({
  email: `${unique('user')}@example.test`,
  username: unique('user'),
  password: 'Sup3rSecret!',
  displayName: 'Auth Test',
  ...overrides,
});

const register = (body: Record<string, unknown>) =>
  request(app).post('/api/v1/auth/register').send(body);

describe('auth: refresh rotation', () => {
  it('lets exactly one of several concurrent refreshes of the same token win', async () => {
    const registered = await register(registerBody());
    const { refreshToken } = registered.body as { refreshToken: string };
    const userId = registered.body.user.id as string;

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post('/api/v1/auth/refresh').send({ refreshToken }),
      ),
    );

    assert.deepEqual(responses.map((res) => res.status).sort(), [200, 401, 401, 401, 401]);
    for (const loser of responses.filter((res) => res.status === 401)) {
      assert.equal(loser.body.error.code, 'TOKEN_REUSE_DETECTED');
    }

    // A lost rotation is indistinguishable from theft, so every session is gone.
    const active = await prisma.refreshToken.count({ where: { userId, revokedAt: null } });
    assert.equal(active, 0);
  });

  it('rotates a token once and rejects its reuse afterwards', async () => {
    const registered = await register(registerBody());
    const { refreshToken } = registered.body as { refreshToken: string };

    const rotated = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    assert.equal(rotated.status, 200);
    assert.notEqual(rotated.body.refreshToken, refreshToken);

    const reused = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    assert.equal(reused.status, 401);
    assert.equal(reused.body.error.code, 'TOKEN_REUSE_DETECTED');
  });
});

describe('auth: register', () => {
  it('maps two concurrent registrations of the same email to one 201 and one 409', async () => {
    const email = `${unique('user')}@example.test`;
    const responses = await Promise.all([
      register(registerBody({ email })),
      register(registerBody({ email })),
    ]);

    assert.deepEqual(responses.map((res) => res.status).sort(), [201, 409]);
    const loser = responses.find((res) => res.status === 409);
    assert.equal(loser?.body.error.code, 'EMAIL_ALREADY_REGISTERED');
  });

  it('maps two concurrent registrations of the same username to one 201 and one 409', async () => {
    const username = unique('user');
    const responses = await Promise.all([
      register(registerBody({ username })),
      register(registerBody({ username })),
    ]);

    assert.deepEqual(responses.map((res) => res.status).sort(), [201, 409]);
    const loser = responses.find((res) => res.status === 409);
    assert.equal(loser?.body.error.code, 'USERNAME_TAKEN');
  });

  it('reports a taken username and a taken email with different codes', async () => {
    const first = registerBody();
    await register(first).expect(201);

    const sameEmail = await register(registerBody({ email: first.email })).expect(409);
    assert.equal(sameEmail.body.error.code, 'EMAIL_ALREADY_REGISTERED');

    const sameUsername = await register(registerBody({ username: first.username })).expect(409);
    assert.equal(sameUsername.body.error.code, 'USERNAME_TAKEN');
  });

  it('rejects a password longer than 72 bytes, which bcrypt would silently truncate', async () => {
    // 40 two-byte characters: 40 characters but 80 bytes.
    const res = await register(registerBody({ password: 'é'.repeat(40) })).expect(422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');

    await register(registerBody({ password: 'é'.repeat(36) })).expect(201);
  });
});

describe('auth: login', () => {
  it('answers an unknown email and a wrong password identically', async () => {
    const user = registerBody();
    await register(user).expect(201);

    const unknown = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `${unique('ghost')}@example.test`, password: 'Sup3rSecret!' })
      .expect(401);
    const wrong = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'not-the-password' })
      .expect(401);

    assert.equal(unknown.body.error.code, 'INVALID_CREDENTIALS');
    assert.deepEqual(unknown.body, wrong.body);
  });
});
