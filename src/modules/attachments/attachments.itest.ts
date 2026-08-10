import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../../app/app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { registerTestUser, createTestHousehold } from '../../shared/testing/http.js';

after(async () => {
  await prisma.$disconnect();
});

const authed = (token: string) => (req: request.Test) =>
  req.set('Authorization', `Bearer ${token}`);

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-but-signature-valid-png-body'),
]);

const createExpense = async (token: string, householdId: string, payerId: string) => {
  const res = await authed(token)(request(app).post(`/api/v1/households/${householdId}/expenses`))
    .send({
      description: 'Ferretería',
      amount: '10.00',
      currencyCode: 'ARS',
      expenseDate: '2026-01-01',
      paidBy: payerId,
      splitType: 'equal',
      participants: [{ userId: payerId }],
    })
    .expect(201);
  return res.body.id as string;
};

describe('attachments', () => {
  it('rejects an unauthenticated request', async () => {
    await request(app)
      .get(
        '/api/v1/households/00000000-0000-0000-0000-000000000000/expenses/00000000-0000-0000-0000-000000000000/attachments',
      )
      .expect(401);
  });

  it('uploads a valid file, sniffing the real mime type, and can list/download/delete it', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const expenseId = await createExpense(admin.accessToken, householdId, admin.id);

    const uploaded = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/expenses/${expenseId}/attachments`),
    )
      .attach('file', PNG_BYTES, {
        filename: 'receipt.png',
        contentType: 'application/octet-stream',
      })
      .expect(201);
    assert.equal(uploaded.body.mimeType, 'image/png');
    assert.equal(uploaded.body.originalFilename, 'receipt.png');

    const list = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/expenses/${expenseId}/attachments`),
    ).expect(200);
    assert.equal(list.body.length, 1);

    const download = await authed(admin.accessToken)(
      request(app).get(
        `/api/v1/households/${householdId}/expenses/${expenseId}/attachments/${uploaded.body.id}/download`,
      ),
    ).expect(200);
    assert.ok(download.body.url.startsWith('/api/v1/files/local/'));

    const fetched = await request(app).get(download.body.url).expect(200);
    assert.ok(Buffer.from(fetched.body).equals(PNG_BYTES));

    await authed(admin.accessToken)(
      request(app).delete(
        `/api/v1/households/${householdId}/expenses/${expenseId}/attachments/${uploaded.body.id}`,
      ),
    ).expect(204);

    const listAfter = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/expenses/${expenseId}/attachments`),
    ).expect(200);
    assert.equal(listAfter.body.length, 0);
  });

  it('rejects a file whose content does not match its claimed extension', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const expenseId = await createExpense(admin.accessToken, householdId, admin.id);

    const res = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/expenses/${expenseId}/attachments`),
    )
      .attach('file', Buffer.from('#!/bin/sh\necho not-a-real-image'), {
        filename: 'totally-a-photo.png',
        contentType: 'image/png',
      })
      .expect(422);
    assert.equal(res.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('deduplicates re-uploading the same file to the same expense', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const expenseId = await createExpense(admin.accessToken, householdId, admin.id);

    const first = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/expenses/${expenseId}/attachments`),
    )
      .attach('file', PNG_BYTES, { filename: 'a.png', contentType: 'image/png' })
      .expect(201);

    const second = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/expenses/${expenseId}/attachments`),
    )
      .attach('file', PNG_BYTES, { filename: 'a-again.png', contentType: 'image/png' })
      .expect(201);

    assert.equal(first.body.id, second.body.id);

    const list = await authed(admin.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/expenses/${expenseId}/attachments`),
    ).expect(200);
    assert.equal(list.body.length, 1);
  });

  it('rejects a non-member', async () => {
    const admin = await registerTestUser(app);
    const outsider = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const expenseId = await createExpense(admin.accessToken, householdId, admin.id);

    await authed(outsider.accessToken)(
      request(app).get(`/api/v1/households/${householdId}/expenses/${expenseId}/attachments`),
    ).expect(403);
  });

  it('rejects a sixth attachment on the same expense', async () => {
    const admin = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);
    const expenseId = await createExpense(admin.accessToken, householdId, admin.id);

    for (let i = 0; i < 5; i++) {
      const distinctBytes = Buffer.concat([PNG_BYTES, Buffer.from([i])]);
      await authed(admin.accessToken)(
        request(app).post(`/api/v1/households/${householdId}/expenses/${expenseId}/attachments`),
      )
        .attach('file', distinctBytes, { filename: `f${i}.png`, contentType: 'image/png' })
        .expect(201);
    }

    const sixth = await authed(admin.accessToken)(
      request(app).post(`/api/v1/households/${householdId}/expenses/${expenseId}/attachments`),
    )
      .attach('file', Buffer.concat([PNG_BYTES, Buffer.from([99])]), {
        filename: 'f6.png',
        contentType: 'image/png',
      })
      .expect(422);
    assert.equal(sixth.body.error.code, 'TOO_MANY_ATTACHMENTS');
  });
});
