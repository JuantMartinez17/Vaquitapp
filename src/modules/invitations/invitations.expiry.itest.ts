import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../../app/app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { registerTestUser, createTestHousehold } from '../../shared/testing/http.js';
import type { TestUser } from '../../shared/testing/http.js';

after(async () => {
  await prisma.$disconnect();
});

const invitationsUrl = (householdId: string, suffix = '') =>
  `/api/v1/households/${householdId}/invitations${suffix}`;

const invite = (admin: TestUser, householdId: string, email: string) =>
  request(app)
    .post(invitationsUrl(householdId))
    .set('Authorization', `Bearer ${admin.accessToken}`)
    .send({ invitedEmail: email });

const listInvitations = async (admin: TestUser, householdId: string) => {
  const res = await request(app)
    .get(invitationsUrl(householdId))
    .set('Authorization', `Bearer ${admin.accessToken}`)
    .expect(200);
  return res.body as { id: string; status: string }[];
};

const expireNow = (invitationId: string) =>
  prisma.invitation.update({
    where: { id: invitationId },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });

describe('invitations: expiry', () => {
  it('lets an admin invite again once the pending invitation has expired', async () => {
    const admin = await registerTestUser(app);
    const invitee = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    const first = await invite(admin, householdId, invitee.email).expect(201);
    await expireNow(first.body.id);

    const second = await invite(admin, householdId, invitee.email).expect(201);
    assert.notEqual(second.body.id, first.body.id);
    assert.equal(second.body.status, 'pending');

    // The stale row was closed out, so the one-pending-per-email index is free.
    const stale = await prisma.invitation.findUniqueOrThrow({ where: { id: first.body.id } });
    assert.equal(stale.status, 'expired');

    // And the fresh invitation is still protected from duplicates.
    const duplicate = await invite(admin, householdId, invitee.email).expect(409);
    assert.equal(duplicate.body.error.code, 'INVITATION_ALREADY_PENDING');
  });

  it('only expires invitations for the same household and email', async () => {
    const admin = await registerTestUser(app);
    const invitee = await registerTestUser(app);
    const other = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const otherHouseholdId = await createTestHousehold(app, admin);

    const stale = await invite(admin, householdId, invitee.email).expect(201);
    await expireNow(stale.body.id);
    const sameEmailElsewhere = await invite(admin, otherHouseholdId, invitee.email).expect(201);
    await expireNow(sameEmailElsewhere.body.id);

    await invite(admin, householdId, other.email).expect(201);

    const untouched = await prisma.invitation.findUniqueOrThrow({
      where: { id: stale.body.id },
    });
    assert.equal(untouched.status, 'pending');
    const elsewhere = await prisma.invitation.findUniqueOrThrow({
      where: { id: sameEmailElsewhere.body.id },
    });
    assert.equal(elsewhere.status, 'pending');
  });

  it('reports a lapsed pending invitation as expired in the household list', async () => {
    const admin = await registerTestUser(app);
    const invitee = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    const created = await invite(admin, householdId, invitee.email).expect(201);
    assert.equal((await listInvitations(admin, householdId))[0]?.status, 'pending');

    await expireNow(created.body.id);
    const [listed] = await listInvitations(admin, householdId);
    assert.equal(listed?.status, 'expired');
  });

  it('does not offer a lapsed invitation in the invitee own list', async () => {
    const admin = await registerTestUser(app);
    const invitee = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const created = await invite(admin, householdId, invitee.email).expect(201);
    await expireNow(created.body.id);

    const mine = await request(app)
      .get('/api/v1/users/me/invitations')
      .set('Authorization', `Bearer ${invitee.accessToken}`)
      .expect(200);
    assert.deepEqual(mine.body, []);
  });

  it('rejects accepting an expired invitation, before and after it was closed out', async () => {
    const admin = await registerTestUser(app);
    const invitee = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const created = await invite(admin, householdId, invitee.email).expect(201);
    await expireNow(created.body.id);

    const accept = () =>
      request(app)
        .post(`/api/v1/invitations/${created.body.token}/accept`)
        .set('Authorization', `Bearer ${invitee.accessToken}`);

    const lapsed = await accept().expect(409);
    assert.equal(lapsed.body.error.code, 'INVITATION_EXPIRED');

    // Re-inviting closes the old row as 'expired'; its token must keep saying so.
    await invite(admin, householdId, invitee.email).expect(201);
    const closed = await accept().expect(409);
    assert.equal(closed.body.error.code, 'INVITATION_EXPIRED');
  });

  it('lets an admin revoke an invitation that already expired', async () => {
    const admin = await registerTestUser(app);
    const invitee = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const first = await invite(admin, householdId, invitee.email).expect(201);
    await expireNow(first.body.id);
    await invite(admin, householdId, invitee.email).expect(201);

    await request(app)
      .delete(invitationsUrl(householdId, `/${first.body.id}`))
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(204);
  });
});

describe('invitations: concurrent resolution', () => {
  it('never lets a revoke delete an invitation that a concurrent accept resolved', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    for (let round = 0; round < 6; round += 1) {
      const invitee = await registerTestUser(app);
      const created = await invite(admin, householdId, invitee.email).expect(201);

      const [accepted, revoked] = await Promise.all([
        request(app)
          .post(`/api/v1/invitations/${created.body.token}/accept`)
          .set('Authorization', `Bearer ${invitee.accessToken}`),
        request(app)
          .delete(invitationsUrl(householdId, `/${created.body.id}`))
          .set('Authorization', `Bearer ${admin.accessToken}`),
      ]);

      const stored = await prisma.invitation.findUnique({ where: { id: created.body.id } });
      const membership = await prisma.householdMember.findFirst({
        where: { householdId, userId: invitee.id, leftAt: null },
      });
      if (accepted.status === 200) {
        assert.equal(revoked.status, 409);
        assert.equal(stored?.status, 'accepted');
        assert.ok(membership);
      } else {
        // Revoked first: the accept either never found the row (404) or lost
        // it between reading and resolving it (409), and joined nobody.
        assert.ok([404, 409].includes(accepted.status), `accept got ${accepted.status}`);
        assert.equal(revoked.status, 204);
        assert.equal(stored, null);
        assert.equal(membership, null);
      }
    }
  });

  it('lets exactly one of several concurrent accepts join the household', async () => {
    const admin = await registerTestUser(app);
    const invitee = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const created = await invite(admin, householdId, invitee.email).expect(201);

    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app)
          .post(`/api/v1/invitations/${created.body.token}/accept`)
          .set('Authorization', `Bearer ${invitee.accessToken}`),
      ),
    );

    assert.equal(responses.filter((res) => res.status === 200).length, 1);
    for (const res of responses.filter((r) => r.status !== 200)) {
      assert.equal(res.status, 409);
    }
  });
});
