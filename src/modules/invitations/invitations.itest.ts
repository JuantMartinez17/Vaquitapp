import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../../app/app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { registerTestUser, createTestHousehold } from '../../shared/testing/http.js';

after(async () => {
  await prisma.$disconnect();
});

describe('invitations', () => {
  it('rejects an unauthenticated request', async () => {
    await request(app)
      .get('/api/v1/households/00000000-0000-0000-0000-000000000000/invitations')
      .expect(401);
  });

  it('lets an admin invite, and the invitee accept, joining the household', async () => {
    const admin = await registerTestUser(app);
    const invitee = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    const invite = await request(app)
      .post(`/api/v1/households/${householdId}/invitations`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ invitedEmail: invitee.email })
      .expect(201);
    assert.equal(invite.body.status, 'pending');
    assert.equal(invite.body.invitedEmail, invitee.email);
    assert.ok(invite.body.token);

    // A second invite to the same pending email conflicts.
    await request(app)
      .post(`/api/v1/households/${householdId}/invitations`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ invitedEmail: invitee.email })
      .expect(409)
      .expect((res) => assert.equal(res.body.error.code, 'INVITATION_ALREADY_PENDING'));

    // A non-member cannot see the household's invitations.
    await request(app)
      .get(`/api/v1/households/${householdId}/invitations`)
      .set('Authorization', `Bearer ${invitee.accessToken}`)
      .expect(403);

    // Someone else's token doesn't work — only the invited email can resolve it.
    const stranger = await registerTestUser(app);
    await request(app)
      .post(`/api/v1/invitations/${invite.body.token}/accept`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .expect(403);

    const accept = await request(app)
      .post(`/api/v1/invitations/${invite.body.token}/accept`)
      .set('Authorization', `Bearer ${invitee.accessToken}`)
      .expect(200);
    assert.equal(accept.body.userId, invitee.id);
    assert.equal(accept.body.role, 'member');

    const members = await request(app)
      .get(`/api/v1/households/${householdId}/members`)
      .set('Authorization', `Bearer ${invitee.accessToken}`)
      .expect(200);
    assert.equal(members.body.length, 2);

    // Already resolved: accepting again fails instead of joining twice.
    await request(app)
      .post(`/api/v1/invitations/${invite.body.token}/accept`)
      .set('Authorization', `Bearer ${invitee.accessToken}`)
      .expect(409)
      .expect((res) => assert.equal(res.body.error.code, 'INVITATION_ALREADY_RESOLVED'));
  });

  it('lets the invitee reject an invitation', async () => {
    const admin = await registerTestUser(app);
    const invitee = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    const invite = await request(app)
      .post(`/api/v1/households/${householdId}/invitations`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ invitedEmail: invitee.email })
      .expect(201);

    await request(app)
      .post(`/api/v1/invitations/${invite.body.token}/reject`)
      .set('Authorization', `Bearer ${invitee.accessToken}`)
      .expect(204);

    await request(app)
      .post(`/api/v1/invitations/${invite.body.token}/accept`)
      .set('Authorization', `Bearer ${invitee.accessToken}`)
      .expect(409)
      .expect((res) => assert.equal(res.body.error.code, 'INVITATION_ALREADY_RESOLVED'));
  });

  it('rejects an expired invitation', async () => {
    const admin = await registerTestUser(app);
    const invitee = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    const invite = await request(app)
      .post(`/api/v1/households/${householdId}/invitations`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ invitedEmail: invitee.email })
      .expect(201);

    await prisma.invitation.update({
      where: { id: invite.body.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await request(app)
      .post(`/api/v1/invitations/${invite.body.token}/accept`)
      .set('Authorization', `Bearer ${invitee.accessToken}`)
      .expect(409)
      .expect((res) => assert.equal(res.body.error.code, 'INVITATION_EXPIRED'));
  });

  it('lets an admin revoke a pending invitation, freeing the email for a new one', async () => {
    const admin = await registerTestUser(app);
    const invitee = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    const invite = await request(app)
      .post(`/api/v1/households/${householdId}/invitations`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ invitedEmail: invitee.email })
      .expect(201);

    await request(app)
      .delete(`/api/v1/households/${householdId}/invitations/${invite.body.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(204);

    // Revoking again (already gone) is a conflict, not a silent success.
    await request(app)
      .delete(`/api/v1/households/${householdId}/invitations/${invite.body.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(404);

    await request(app)
      .post(`/api/v1/households/${householdId}/invitations`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ invitedEmail: invitee.email })
      .expect(201);
  });

  it("lists the invitee's pending invitations under /users/me/invitations", async () => {
    const admin = await registerTestUser(app);
    const invitee = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    await request(app)
      .post(`/api/v1/households/${householdId}/invitations`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ invitedEmail: invitee.email })
      .expect(201);

    const mine = await request(app)
      .get('/api/v1/users/me/invitations')
      .set('Authorization', `Bearer ${invitee.accessToken}`)
      .expect(200);
    assert.equal(mine.body.length, 1);
    assert.equal(mine.body[0].householdId, householdId);
  });
});
