import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../../app/app.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { registerTestUser, createTestHousehold } from '../../shared/testing/http.js';

after(async () => {
  await prisma.$disconnect();
});

describe('categories', () => {
  it('lists the global catalog without authentication', async () => {
    const res = await request(app).get('/api/v1/categories').expect(200);
    assert.ok(res.body.length > 0);
    assert.ok(res.body.every((c: { isSystem: boolean }) => c.isSystem));
    assert.ok(res.body.some((c: { name: string }) => c.name === 'Otros'));
  });

  it('rejects an unauthenticated household categories request', async () => {
    await request(app)
      .get('/api/v1/households/00000000-0000-0000-0000-000000000000/categories')
      .expect(401);
  });

  it('merges global and household categories, and only an admin can manage the household ones', async () => {
    const admin = await registerTestUser(app);
    const member = await registerTestUser(app);
    const householdId = await createTestHousehold(app, admin);

    const globalCount = (await request(app).get('/api/v1/categories').expect(200)).body.length;

    const created = await request(app)
      .post(`/api/v1/households/${householdId}/categories`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: 'Mascotas', icon: 'paw', color: '#ABCDEF' })
      .expect(201);
    assert.equal(created.body.isSystem, false);
    assert.equal(created.body.householdId, householdId);

    // A non-member can't even attempt this.
    await request(app)
      .post(`/api/v1/households/${householdId}/categories`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ name: 'Otra', color: '#111111' })
      .expect(403);

    const merged = await request(app)
      .get(`/api/v1/households/${householdId}/categories`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    assert.equal(merged.body.length, globalCount + 1);

    const updated = await request(app)
      .patch(`/api/v1/households/${householdId}/categories/${created.body.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: 'Mascotas y veterinaria' })
      .expect(200);
    assert.equal(updated.body.name, 'Mascotas y veterinaria');

    // A system category can be listed, but not mutated through the household route.
    const systemCategory = merged.body.find((c: { isSystem: boolean }) => c.isSystem);
    await request(app)
      .patch(`/api/v1/households/${householdId}/categories/${systemCategory.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: 'Hacked' })
      .expect(403);

    await request(app)
      .delete(`/api/v1/households/${householdId}/categories/${created.body.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(204);

    const afterDelete = await request(app)
      .get(`/api/v1/households/${householdId}/categories`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    assert.equal(afterDelete.body.length, globalCount);
  });
});
