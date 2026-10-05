import { UnrecoverableError } from 'bullmq';
import request from 'supertest';
import webpush from 'web-push';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../src/common/ids';
import { PushDeliveryService } from '../src/modules/push/push-delivery.service';
import { MAX_PUSH_SUBSCRIPTIONS_PER_USER } from '../src/modules/push/push.service';
import { VAPID_SETTING_KEY } from '../src/modules/push/vapid.service';
import { WebPushSender } from '../src/modules/push/web-push.sender';
import { bearer, createTestApp, createUser, waitFor, type TestApp } from './support/app';
import { FakePushSender } from './support/fake-push-sender';

const sender = new FakePushSender();
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({}, [{ provide: WebPushSender, useValue: sender }]);
});
afterAll(async () => {
  await t.close();
});
beforeEach(() => sender.reset());

let endpointSeq = 0;
const endpoint = (host = 'fcm.googleapis.com') => `https://${host}/fcm/send/test-${endpointSeq++}`;
const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
const subscribe = (token: string, ep: string) => request(t.http).post('/api/v1/push/subscriptions').set(bearer(token)).send({ endpoint: ep, keys });
const unsubscribe = (token: string, ep: string) => request(t.http).delete('/api/v1/push/subscriptions').set(bearer(token)).send({ endpoint: ep });

describe('VAPID public key', () => {
  it('is generated once, stored in app_settings and reused after a restart', async () => {
    const u = await createUser(t);
    const res = await request(t.http).get('/api/v1/push/vapid-public-key').set(bearer(u.token)).expect(200);
    expect(res.body.key).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    const stored = await t.prisma.appSetting.findUniqueOrThrow({ where: { key: VAPID_SETTING_KEY } });
    expect((stored.value as { publicKey: string }).publicKey).toBe(res.body.key);

    const restarted = await createTestApp();
    try {
      const again = await request(restarted.http).get('/api/v1/push/vapid-public-key').set(bearer(u.token)).expect(200);
      expect(again.body.key).toBe(res.body.key);
    } finally {
      await restarted.close();
    }
    expect(await t.prisma.appSetting.count()).toBe(1);
    await request(t.http).get('/api/v1/push/vapid-public-key').expect(401);
  });

  it('prefers keys from the environment', async () => {
    const pair = webpush.generateVAPIDKeys();
    const app = await createTestApp({ VAPID_PUBLIC_KEY: pair.publicKey, VAPID_PRIVATE_KEY: pair.privateKey });
    try {
      const u = await createUser(app);
      const res = await request(app.http).get('/api/v1/push/vapid-public-key').set(bearer(u.token)).expect(200);
      expect(res.body.key).toBe(pair.publicKey);
    } finally {
      await app.close();
    }
  });
});

describe('push subscriptions', () => {
  it('upserts by endpoint for its owner, refuses endpoints owned by others and only lets the owner delete', async () => {
    const a = await createUser(t);
    const b = await createUser(t);
    const ep = endpoint();
    await subscribe(a.token, ep).expect(204);
    await subscribe(a.token, ep).expect(204);
    expect(await t.prisma.pushSubscription.findMany({ where: { endpoint: ep } })).toEqual([expect.objectContaining({ userId: a.id })]);

    // Another account can't take over (or overwrite the keys of) an endpoint registered by someone else.
    const res = await request(t.http)
      .post('/api/v1/push/subscriptions')
      .set(bearer(b.token))
      .send({ endpoint: ep, keys: { p256dh: 'B'.repeat(80), auth: 'attackerAuth1' } })
      .expect(409);
    expect(res.body.error.code).toBe('PUSH_ENDPOINT_IN_USE');
    expect(await t.prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: ep } })).toMatchObject({ userId: a.id, p256dh: keys.p256dh, auth: keys.auth });

    await unsubscribe(b.token, ep).expect(204); // not b's: no effect
    expect(await t.prisma.pushSubscription.count({ where: { endpoint: ep } })).toBe(1);
    await unsubscribe(a.token, ep).expect(204);
    expect(await t.prisma.pushSubscription.count({ where: { endpoint: ep } })).toBe(0);
    await unsubscribe(a.token, ep).expect(204);
    // Once released (the owner signed out), the browser can register for the other account.
    await subscribe(b.token, ep).expect(204);
  });

  it('stores the normalized endpoint and refuses parser-differential SSRF endpoints', async () => {
    const u = await createUser(t);
    await subscribe(u.token, 'https://FCM.googleapis.com:443/fcm/send/norm-1').expect(204);
    expect(await t.prisma.pushSubscription.count({ where: { endpoint: 'https://fcm.googleapis.com/fcm/send/norm-1' } })).toBe(1);
    await unsubscribe(u.token, 'https://FCM.googleapis.com:443/fcm/send/norm-1').expect(204);
    expect(await t.prisma.pushSubscription.count({ where: { userId: u.id } })).toBe(0);
    for (const ep of ['https://127.0.0.1;.googleapis.com/ssrf-proof', 'https://169.254.169.254;.googleapis.com/latest/meta-data', 'https://localhost;.mozilla.com/x']) {
      const res = await subscribe(u.token, ep).expect(400);
      expect(res.body.error.code).toMatch(/INVALID_PUSH_ENDPOINT|VALIDATION_ERROR/);
    }
    expect(await t.prisma.pushSubscription.count({ where: { userId: u.id } })).toBe(0);
  });

  it('accepts only browser push services and validates the body', async () => {
    const u = await createUser(t);
    for (const ep of ['https://evil.example.com/push', 'http://fcm.googleapis.com/fcm/send/x', 'https://127.0.0.1/x']) {
      const res = await subscribe(u.token, ep).expect(400);
      expect(res.body.error.code).toMatch(/INVALID_PUSH_ENDPOINT|VALIDATION_ERROR/);
    }
    await subscribe(u.token, 'https://web.push.apple.com/abc').expect(204);
    await subscribe(u.token, 'https://updates.push.services.mozilla.com/wpush/v2/abc').expect(204);
    const res = await request(t.http).post('/api/v1/push/subscriptions').set(bearer(u.token)).send({ endpoint: endpoint() }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it(`keeps the newest ${MAX_PUSH_SUBSCRIPTIONS_PER_USER} subscriptions per user`, async () => {
    const u = await createUser(t);
    const eps = Array.from({ length: MAX_PUSH_SUBSCRIPTIONS_PER_USER + 2 }, () => endpoint());
    for (const ep of eps) await subscribe(u.token, ep).expect(204);
    const left = await t.prisma.pushSubscription.findMany({ where: { userId: u.id }, select: { endpoint: true } });
    expect(left.map((s) => s.endpoint).sort()).toEqual(eps.slice(2).sort());
  });
});

describe('push delivery', () => {
  it('pushes a localized friend request to each of the addressee devices', async () => {
    const from = await createUser(t, { nickname: 'pusher', name: 'Pusher' });
    const ru = await createUser(t, { locale: 'ru' });
    const en = await createUser(t, { locale: 'en' });
    const [ep1, ep2, ep3] = [endpoint(), endpoint('updates.push.services.mozilla.com'), endpoint()];
    await subscribe(ru.token, ep1).expect(204);
    await subscribe(ru.token, ep2).expect(204);
    await subscribe(en.token, ep3).expect(204);

    await request(t.http).post('/api/v1/friends/requests').set(bearer(from.token)).send({ userId: ru.id }).expect(201);
    await request(t.http).post('/api/v1/friends/requests').set(bearer(from.token)).send({ userId: en.id }).expect(201);
    await waitFor(() => sender.sent.length >= 3);
    const byEndpoint = new Map(sender.sent.map((s) => [s.endpoint, s.payload]));
    expect(byEndpoint.get(ep1)).toEqual({
      title: 'Заявка в друзья',
      body: 'Pusher (@pusher) хочет добавить вас в друзья',
      url: `/u/${from.id}`,
      tag: `friend_request:${from.id}`,
    });
    expect(byEndpoint.get(ep2)).toEqual(byEndpoint.get(ep1));
    expect(byEndpoint.get(ep3)).toMatchObject({ title: 'Friend request', body: 'Pusher (@pusher) wants to be your friend' });
    const key = (await request(t.http).get('/api/v1/push/vapid-public-key').set(bearer(from.token))).body.key;
    expect(sender.sent.every((s) => s.vapidPublicKey === key)).toBe(true);

    // Accepting pushes friend_accepted to the requester (no subscriptions → nothing sent, no error).
    const req = await t.prisma.friendship.findFirstOrThrow({ where: { requesterId: from.id, addresseeId: en.id } });
    await request(t.http).post(`/api/v1/friends/requests/${req.id}/accept`).set(bearer(en.token)).expect(204);
  });

  it('deletes subscriptions the push service reports as gone (404/410)', async () => {
    const from = await createUser(t);
    const to = await createUser(t);
    const gone = endpoint();
    const notFound = endpoint();
    const alive = endpoint();
    for (const ep of [gone, notFound, alive]) await subscribe(to.token, ep).expect(204);
    sender.respond = (ep) => (ep === gone ? 410 : ep === notFound ? 404 : undefined);

    await request(t.http).post('/api/v1/friends/requests').set(bearer(from.token)).send({ userId: to.id }).expect(201);
    await waitFor(async () => (await t.prisma.pushSubscription.count({ where: { userId: to.id } })) === 1);
    expect((await t.prisma.pushSubscription.findMany({ where: { userId: to.id } })).map((s) => s.endpoint)).toEqual([alive]);
    expect(sender.sent.map((s) => s.endpoint)).toEqual([alive]);
  });

  it('never fails the HTTP request when push delivery fails', async () => {
    const from = await createUser(t);
    const to = await createUser(t);
    const ep = endpoint();
    await subscribe(to.token, ep).expect(204);
    sender.respond = () => 503;
    await request(t.http).post('/api/v1/friends/requests').set(bearer(from.token)).send({ userId: to.id }).expect(201);
    await waitFor(() => sender.attempts.includes(ep));
    // Retryable failure: the subscription is kept and the notification is stored.
    expect(await t.prisma.pushSubscription.count({ where: { endpoint: ep } })).toBe(1);
    expect(await t.prisma.notification.count({ where: { userId: to.id, type: 'friend_request' } })).toBe(1);
  });

  it('classifies push service responses: gone → deleted, 4xx → not retried, 429/5xx → retried', async () => {
    const delivery = t.app.get(PushDeliveryService);
    const u = await createUser(t);
    const ep = endpoint();
    await subscribe(u.token, ep).expect(204);
    const sub = await t.prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: ep } });
    const payload = { title: 't', body: 'b', url: '/', tag: 'x' };

    expect(await delivery.deliver(sub.id, payload)).toBe('sent');
    sender.respond = () => 400;
    await expect(delivery.deliver(sub.id, payload)).rejects.toBeInstanceOf(UnrecoverableError);
    for (const status of [429, 500, 503]) {
      sender.respond = () => status;
      const err = await delivery.deliver(sub.id, payload).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(UnrecoverableError);
    }
    sender.respond = () => 410;
    expect(await delivery.deliver(sub.id, payload)).toBe('gone');
    expect(await t.prisma.pushSubscription.count({ where: { id: sub.id } })).toBe(0);
    expect(await delivery.deliver(sub.id, payload)).toBe('skipped');
    expect(await delivery.deliver(newId(), payload)).toBe('skipped');
  });
});
