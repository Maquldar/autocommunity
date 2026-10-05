import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../src/common/ids';
import { bearer, createCommunity, createTestApp, createUser, type TestApp } from './support/app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('onboarding gate (review M3)', () => {
  it('blocks every action towards other people with 403 ONBOARDING_INCOMPLETE until onboarding is complete', async () => {
    const other = await createUser(t);
    const community = await createCommunity(t, other.id);
    const fresh = await createUser(t, { onboarded: false, nickname: null });
    const auth = bearer(fresh.token);
    const calls: [string, () => request.Test][] = [
      ['create community', () => request(t.http).post('/api/v1/communities').set(auth).send({ name: 'Fresh club', isPrivate: false })],
      ['join community', () => request(t.http).post(`/api/v1/communities/${community}/join`).set(auth)],
      ['direct chat', () => request(t.http).post('/api/v1/chats/direct').set(auth).send({ userId: other.id })],
      ['send message', () => request(t.http).post(`/api/v1/chats/${newId()}/messages`).set(auth).send({ type: 'text', text: 'hi' })],
      ['create SOS', () => request(t.http).post('/api/v1/sos').set(auth).send({ type: 'other', lat: 43.2, lng: 76.9, sharePhone: false })],
      ['respond SOS', () => request(t.http).post(`/api/v1/sos/${newId()}/respond`).set(auth)],
      ['friend request', () => request(t.http).post('/api/v1/friends/requests').set(auth).send({ userId: other.id })],
      ['report', () => request(t.http).post('/api/v1/reports').set(auth).send({ targetType: 'user', targetId: other.id, reason: 'spam' })],
    ];
    for (const [label, call] of calls) {
      const res = await call();
      expect(res.status, label).toBe(403);
      expect(res.body.error, label).toMatchObject({ code: 'ONBOARDING_INCOMPLETE', details: { missing: ['nickname'] } });
    }
    // Reading stays possible; after onboarding the same calls go through.
    await request(t.http).get('/api/v1/communities').set(auth).expect(200);
    await t.prisma.user.update({ where: { id: fresh.id }, data: { nickname: `fresh_${newId().slice(-6)}`, onboardedAt: new Date() } });
    await calls[1]![1]().expect(200);
    await calls[6]![1]().expect(201);
  });
});
