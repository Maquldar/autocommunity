import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApp, createUser, loginWithOtp, makeFriends, nextIp, nextPhone, readCookies, type TestApp } from './support/app';
import { pngImage } from './support/images';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const patchMe = (token: string, body: object) => request(t.http).patch('/api/v1/me').set(bearer(token)).send(body);
let png: Buffer;
beforeAll(async () => {
  png = await pngImage();
});
const uploadAvatar = (token: string, purpose = 'avatar') =>
  request(t.http)
    .post('/api/v1/uploads')
    .set(bearer(token))
    .field('purpose', purpose)
    .attach('file', png, { filename: 'a.png', contentType: 'image/png' });

describe('PATCH /me', () => {
  it('updates profile fields and normalizes nickname to lower case', async () => {
    const s = await loginWithOtp(t);
    const res = await patchMe(s.accessToken, { name: '  Асет  ', nickname: 'Aset_Driver', city: 'Almaty', bio: 'Camry 2019', locale: 'en' }).expect(200);
    expect(res.body).toMatchObject({ name: 'Асет', nickname: 'aset_driver', city: 'Almaty', bio: 'Camry 2019', locale: 'en' });
    const cleared = await patchMe(s.accessToken, { bio: null, city: null }).expect(200);
    expect(cleared.body).toMatchObject({ bio: null, city: null, nickname: 'aset_driver' });
  });

  it('returns VALIDATION_ERROR with zod issues', async () => {
    const u = await createUser(t);
    const res = await patchMe(u.token, { nickname: 'a!', city: 'Paris', bio: 'x'.repeat(301), name: '' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = (res.body.error.details as { path: string[] }[]).map((i) => i.path[0]).sort();
    expect(paths).toEqual(expect.arrayContaining(['bio', 'city', 'name', 'nickname']));
  });

  it('ignores unknown keys (role cannot be escalated)', async () => {
    const u = await createUser(t);
    const res = await patchMe(u.token, { role: 'admin', rating: 100, name: 'Ok' }).expect(200);
    expect(res.body).toMatchObject({ role: 'user', rating: 50, name: 'Ok' });
  });

  it('rejects a nickname taken by someone else, case-insensitively', async () => {
    await createUser(t, { nickname: 'taken_nick' });
    const u = await createUser(t);
    const res = await patchMe(u.token, { nickname: 'Taken_Nick' }).expect(409);
    expect(res.body.error.code).toBe('NICKNAME_TAKEN');
    // Re-saving your own nickname is fine.
    const own = await createUser(t, { nickname: 'my_nick' });
    await patchMe(own.token, { nickname: 'my_nick' }).expect(200);
  });

  it('sets, replaces and removes an avatar, deleting the previous upload', async () => {
    const u = await createUser(t);
    const up = await uploadAvatar(u.token).expect(201);
    const res = await patchMe(u.token, { avatarUploadId: up.body.id }).expect(200);
    expect(res.body.avatarUrl).toBe(up.body.thumbUrl);
    await patchMe(u.token, { avatarUploadId: up.body.id }).expect(200);
    expect(await t.prisma.upload.count({ where: { id: up.body.id } })).toBe(1);

    const next = await uploadAvatar(u.token).expect(201);
    await patchMe(u.token, { avatarUploadId: next.body.id }).expect(200);
    expect(await t.prisma.upload.count({ where: { id: up.body.id } })).toBe(0);
    await request(t.http).get(new URL(up.body.url).pathname).expect(404);
    await request(t.http).get(new URL(up.body.thumbUrl).pathname).expect(404);

    const removed = await patchMe(u.token, { avatarUploadId: null }).expect(200);
    expect(removed.body.avatarUrl).toBeNull();
    expect(await t.prisma.upload.count({ where: { id: next.body.id } })).toBe(0);
  });

  it('reserves staff nicknames but lets their holder keep them', async () => {
    const u = await createUser(t);
    for (const nickname of ['admin', 'Support', 'moderator', 'autocommunity', 'system', 'root', 'help']) {
      expect((await patchMe(u.token, { nickname }).expect(409)).body.error.code).toBe('NICKNAME_TAKEN');
    }
    const admin = await createUser(t, { nickname: 'admin', role: 'admin' });
    await patchMe(admin.token, { nickname: 'admin', bio: 'staff' }).expect(200);
  });

  it('rejects invisible characters and nicknames without letters or digits', async () => {
    const u = await createUser(t);
    for (const body of [{ nickname: '___' }, { nickname: '._.' }, { name: 'Ase\u200Bt' }, { name: '\u202Egnp.exe' }, { bio: 'a\u2066b' }]) {
      expect((await patchMe(u.token, body).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it("rejects another user's upload and uploads with a different purpose", async () => {
    const owner = await createUser(t);
    const other = await createUser(t);
    const up = await uploadAvatar(owner.token).expect(201);
    const res = await patchMe(other.token, { avatarUploadId: up.body.id }).expect(400);
    expect(res.body.error.code).toBe('INVALID_UPLOAD');

    const post = await uploadAvatar(owner.token, 'post').expect(201);
    expect((await patchMe(owner.token, { avatarUploadId: post.body.id }).expect(400)).body.error.code).toBe('INVALID_UPLOAD');
  });
});

describe('PATCH /me/settings', () => {
  it('updates privacy mode and SOS opt-in', async () => {
    const u = await createUser(t);
    const res = await request(t.http)
      .patch('/api/v1/me/settings')
      .set(bearer(u.token))
      .send({ privacyMode: 'hidden', receiveSos: false })
      .expect(200);
    expect(res.body).toMatchObject({ privacyMode: 'hidden', receiveSos: false });
    await request(t.http).patch('/api/v1/me/settings').set(bearer(u.token)).send({ privacyMode: 'nobody' }).expect(400);
  });
});

describe('POST /me/onboarding/complete', () => {
  it('requires name and nickname', async () => {
    const s = await loginWithOtp(t);
    const res = await request(t.http).post('/api/v1/me/onboarding/complete').set(bearer(s.accessToken)).expect(400);
    expect(res.body.error).toMatchObject({ code: 'ONBOARDING_INCOMPLETE', details: { missing: ['name', 'nickname'] } });

    await patchMe(s.accessToken, { name: 'Dana' }).expect(200);
    const partial = await request(t.http).post('/api/v1/me/onboarding/complete').set(bearer(s.accessToken)).expect(400);
    expect(partial.body.error.details.missing).toEqual(['nickname']);

    await patchMe(s.accessToken, { nickname: `dana_${Date.now() % 100000}` }).expect(200);
    const done = await request(t.http).post('/api/v1/me/onboarding/complete').set(bearer(s.accessToken)).expect(200);
    expect(done.body.onboardingCompleted).toBe(true);
    // Idempotent.
    await request(t.http).post('/api/v1/me/onboarding/complete').set(bearer(s.accessToken)).expect(200);
  });
});

describe('GET /users/:id and plate privacy', () => {
  it('shows the plate only to the owner and accepted friends', async () => {
    const owner = await createUser(t, { nickname: 'plate_owner' });
    const friend = await createUser(t);
    const pending = await createUser(t);
    const stranger = await createUser(t);
    await makeFriends(t, owner.id, friend.id, 'accepted');
    await makeFriends(t, pending.id, owner.id, 'pending');

    await request(t.http)
      .post('/api/v1/me/vehicles')
      .set(bearer(owner.token))
      .send({ brand: 'Toyota', model: 'Camry', year: 2019, plate: '123abc02' })
      .expect(201);

    const asFriend = await request(t.http).get(`/api/v1/users/${owner.id}`).set(bearer(friend.token)).expect(200);
    expect(asFriend.body).toMatchObject({ relation: 'friend', primaryVehicle: { plate: '123ABC02', brand: 'Toyota' } });
    expect(asFriend.body).not.toHaveProperty('phone');

    const asStranger = await request(t.http).get(`/api/v1/users/${owner.id}`).set(bearer(stranger.token)).expect(200);
    expect(asStranger.body).toMatchObject({ relation: 'none', primaryVehicle: { plate: null } });

    const asPending = await request(t.http).get(`/api/v1/users/${owner.id}`).set(bearer(pending.token)).expect(200);
    expect(asPending.body).toMatchObject({ relation: 'request_out', primaryVehicle: { plate: null } });
    const reverse = await request(t.http).get(`/api/v1/users/${pending.id}`).set(bearer(owner.token)).expect(200);
    expect(reverse.body.relation).toBe('request_in');

    const vStranger = await request(t.http).get(`/api/v1/users/${owner.id}/vehicles`).set(bearer(stranger.token)).expect(200);
    expect(vStranger.body[0].plate).toBeNull();
    const vFriend = await request(t.http).get(`/api/v1/users/${owner.id}/vehicles`).set(bearer(friend.token)).expect(200);
    expect(vFriend.body[0].plate).toBe('123ABC02');

    const self = await request(t.http).get(`/api/v1/users/${owner.id}`).set(bearer(owner.token)).expect(200);
    expect(self.body).toMatchObject({ relation: 'self', primaryVehicle: { plate: '123ABC02' } });
  });

  it("reports status 'active' once a temporary block has expired", async () => {
    const viewer = await createUser(t);
    const u = await createUser(t);
    await t.prisma.user.update({ where: { id: u.id }, data: { status: 'blocked', blockedUntil: new Date(Date.now() + 60_000) } });
    expect((await request(t.http).get(`/api/v1/users/${u.id}`).set(bearer(viewer.token)).expect(200)).body.status).toBe('blocked');
    await t.prisma.user.update({ where: { id: u.id }, data: { blockedUntil: new Date(Date.now() - 1000) } });
    expect((await request(t.http).get(`/api/v1/users/${u.id}`).set(bearer(viewer.token)).expect(200)).body.status).toBe('active');
  });

  it('hides users who have not finished onboarding, and 404s unknown ids', async () => {
    const viewer = await createUser(t);
    const fresh = await createUser(t, { nickname: null, onboarded: false });
    await request(t.http).get(`/api/v1/users/${fresh.id}`).set(bearer(viewer.token)).expect(404);
    await request(t.http).get('/api/v1/users/0192a6c5-0000-7000-8000-000000000000').set(bearer(viewer.token)).expect(404);
    const bad = await request(t.http).get('/api/v1/users/not-a-uuid').set(bearer(viewer.token)).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /users?q=', () => {
  it('finds active onboarded users by nickname or name prefix with pagination', async () => {
    const viewer = await createUser(t, { nickname: 'viewer_x' });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await createUser(t, { nickname: `srch_${i}`, name: `Person ${i}` })).id);
    await createUser(t, { nickname: 'zz_other', name: 'Srchname Ivanov' });
    await createUser(t, { nickname: null, name: 'srch hidden', onboarded: false });
    const blocked = await createUser(t, { nickname: 'srch_blocked' });
    await t.prisma.user.update({ where: { id: blocked.id }, data: { status: 'blocked' } });
    await createUser(t, { nickname: 'srchxunderscore' });

    const page1 = await request(t.http).get('/api/v1/users').query({ q: 'SRCH', limit: 4 }).set(bearer(viewer.token)).expect(200);
    expect(page1.body.items).toHaveLength(4);
    expect(page1.body.nextCursor).toEqual(expect.any(String));
    const page2 = await request(t.http)
      .get('/api/v1/users')
      .query({ q: 'srch', limit: 4, cursor: page1.body.nextCursor })
      .set(bearer(viewer.token))
      .expect(200);
    const all = [...page1.body.items, ...page2.body.items].map((u: { nickname: string }) => u.nickname);
    expect(page2.body.nextCursor).toBeNull();
    expect(all.sort()).toEqual(['srch_0', 'srch_1', 'srch_2', 'srch_3', 'srch_4', 'srchxunderscore', 'zz_other'].sort());

    // "_" is matched literally, not as a LIKE wildcard.
    const literal = await request(t.http).get('/api/v1/users').query({ q: 'srch_' }).set(bearer(viewer.token)).expect(200);
    expect(literal.body.items.map((u: { nickname: string }) => u.nickname)).not.toContain('srchxunderscore');

    // Cyrillic names match case-insensitively.
    await createUser(t, { nickname: 'cyr_user', name: 'Айгерим Султанова' });
    const cyr = await request(t.http).get('/api/v1/users').query({ q: 'айг' }).set(bearer(viewer.token)).expect(200);
    expect(cyr.body.items.map((u: { nickname: string }) => u.nickname)).toEqual(['cyr_user']);
  });

  it('validates q and cursor', async () => {
    const viewer = await createUser(t);
    await request(t.http).get('/api/v1/users').query({ q: 'a' }).set(bearer(viewer.token)).expect(400);
    await request(t.http).get('/api/v1/users').query({ q: 'abc', cursor: 'nope' }).set(bearer(viewer.token)).expect(400);
    await request(t.http).get('/api/v1/users').query({ q: 'abc', limit: 51 }).set(bearer(viewer.token)).expect(400);
  });
});

describe('phone linking', () => {
  const oauthUser = async () => {
    const u = await createUser(t);
    await t.prisma.user.update({ where: { id: u.id }, data: { phone: null, phoneVerifiedAt: null } });
    return u;
  };
  const linkRequest = (token: string, phone: string, ip = nextIp()) =>
    request(t.http).post('/api/v1/me/phone/request').set(bearer(token)).set('X-Forwarded-For', ip).send({ phone });
  const linkVerify = (token: string, phone: string, code: string) =>
    request(t.http).post('/api/v1/me/phone/verify').set(bearer(token)).set('X-Forwarded-For', nextIp()).send({ phone, code });

  it('links a verified phone to an account without one', async () => {
    const u = await oauthUser();
    const phone = nextPhone();
    const req = await linkRequest(u.token, phone).expect(200);
    const res = await linkVerify(u.token, phone, req.body.devCode).expect(200);
    expect(res.body).toMatchObject({ phone, phoneVerified: true });
    const identity = await t.prisma.authIdentity.findFirst({ where: { userId: u.id, provider: 'phone' } });
    expect(identity?.providerUid).toBe(phone);
  });

  it('refuses to replace an already verified phone (account takeover via stolen token)', async () => {
    const s = await loginWithOtp(t);
    const attackerPhone = nextPhone();
    const req = await linkRequest(s.accessToken, attackerPhone).expect(409);
    expect(req.body.error.code).toBe('PHONE_ALREADY_VERIFIED');
    const ver = await linkVerify(s.accessToken, attackerPhone, '123456').expect(409);
    expect(ver.body.error.code).toBe('PHONE_ALREADY_VERIFIED');
    const user = await t.prisma.user.findUniqueOrThrow({ where: { id: s.user.id } });
    expect(user.phone).toBe(s.phone);
  });

  it('does not reveal whether a number is registered until the code is verified', async () => {
    const u = await oauthUser();
    const other = await loginWithOtp(t);
    const free = await linkRequest(u.token, nextPhone()).expect(200);
    await t.redis.del(`rl:otp:phone:cooldown:${other.phone}`);
    const taken = await linkRequest(u.token, other.phone).expect(200);
    expect(Object.keys(taken.body).sort()).toEqual(Object.keys(free.body).sort());

    const wrong = await linkVerify(u.token, other.phone, String((Number(taken.body.devCode) + 1) % 1e6).padStart(6, '0')).expect(400);
    expect(wrong.body.error.code).toBe('OTP_INVALID');
    // Only someone who received the SMS learns the number is in use.
    const res = await linkVerify(u.token, other.phone, taken.body.devCode).expect(409);
    expect(res.body.error.code).toBe('PHONE_IN_USE');
  });

  it('rate-limits link verification per user', async () => {
    const u = await oauthUser();
    for (let i = 0; i < 10; i++) await linkVerify(u.token, nextPhone(), '000000').expect(400);
    const res = await linkVerify(u.token, nextPhone(), '000000').expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('DELETE /me', () => {
  it('requires confirmation and anonymizes the account', async () => {
    const s = await loginWithOtp(t);
    await patchMe(s.accessToken, { name: 'To Delete', nickname: `del_${Date.now() % 100000}`, bio: 'bye' }).expect(200);
    const up = await uploadAvatar(s.accessToken).expect(201);
    await patchMe(s.accessToken, { avatarUploadId: up.body.id }).expect(200);
    await request(t.http).post('/api/v1/me/vehicles').set(bearer(s.accessToken)).send({ brand: 'Kia', model: 'Rio', year: 2020 }).expect(201);
    await t.prisma.$executeRaw`INSERT INTO user_locations (user_id, location, updated_at)
      VALUES (${s.user.id}::uuid, ST_SetSRID(ST_MakePoint(76.9, 43.2), 4326)::geography, now())`;
    const friend = await createUser(t);
    await makeFriends(t, s.user.id, friend.id);

    await request(t.http).delete('/api/v1/me').set(bearer(s.accessToken)).send({}).expect(400);
    const res = await request(t.http).delete('/api/v1/me').set(bearer(s.accessToken)).send({ confirm: 'DELETE' }).expect(204);
    expect(readCookies(res)).toMatchObject({ ac_rt: '' });

    const user = await t.prisma.user.findUniqueOrThrow({ where: { id: s.user.id } });
    expect(user).toMatchObject({ name: 'Deleted user', nickname: null, phone: null, bio: null, avatarUploadId: null, status: 'deleted' });
    expect(await t.prisma.vehicle.count({ where: { userId: s.user.id } })).toBe(0);
    expect(await t.prisma.userLocation.count({ where: { userId: s.user.id } })).toBe(0);
    expect(await t.prisma.authIdentity.count({ where: { userId: s.user.id } })).toBe(0);
    expect(await t.prisma.refreshToken.count({ where: { userId: s.user.id } })).toBe(0);
    expect(await t.prisma.friendship.count({ where: { OR: [{ requesterId: s.user.id }, { addresseeId: s.user.id }] } })).toBe(0);
    expect(await t.prisma.upload.count({ where: { id: up.body.id } })).toBe(0);

    await request(t.http).get('/api/v1/me').set(bearer(s.accessToken)).expect((r) => expect([401, 403]).toContain(r.status));
    await request(t.http).get(`/api/v1/users/${s.user.id}`).set(bearer(friend.token)).expect(404);
    await request(t.http)
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`ac_rt=${s.refreshToken}`, `ac_csrf=${s.csrfToken}`])
      .set('X-CSRF-Token', s.csrfToken)
      .expect(401);

    // The phone number is free again: signing in creates a brand-new account.
    await t.redis.del(`rl:otp:phone:cooldown:${s.phone}`);
    const again = await loginWithOtp(t, s.phone);
    expect(again.isNew).toBe(true);
    expect(again.user.id).not.toBe(s.user.id);
  });
});

describe('DELETE /me and notifications', () => {
  it('anonymizes the deleted actor in other users\' notifications and drops their dead friend requests', async () => {
    const leaver = await createUser(t, { name: 'Leaving Person', nickname: 'leaving_person' });
    const friend = await createUser(t);
    const asked = await createUser(t);
    const owner = await createUser(t);
    await makeFriends(t, friend.id, leaver.id, 'pending');
    const f = await t.prisma.friendship.findFirstOrThrow({ where: { requesterId: friend.id, addresseeId: leaver.id } });
    await request(t.http).post(`/api/v1/friends/requests/${f.id}/accept`).set(bearer(leaver.token)).expect(204);
    await request(t.http).post('/api/v1/friends/requests').set(bearer(leaver.token)).send({ userId: asked.id }).expect(201);
    const { body: com } = await request(t.http).post('/api/v1/communities').set(bearer(owner.token)).send({ name: `Anon ${Date.now()}`, isPrivate: true }).expect(201);
    await request(t.http).post(`/api/v1/communities/${com.id}/join`).set(bearer(leaver.token)).expect(200);
    expect(await t.prisma.notification.count({ where: { userId: leaver.id } })).toBeGreaterThanOrEqual(0);

    await request(t.http).delete('/api/v1/me').set(bearer(leaver.token)).send({ confirm: 'DELETE' }).expect(204);

    const accepted = await t.prisma.notification.findFirstOrThrow({ where: { userId: friend.id, type: 'friend_accepted' } });
    expect(accepted.payload).toEqual({ user: { id: leaver.id, nickname: '', name: 'Deleted user', avatarUrl: null, rating: 0 } });
    expect(await t.prisma.notification.count({ where: { userId: asked.id, type: 'friend_request' } })).toBe(0);
    const req = await t.prisma.notification.findFirstOrThrow({ where: { userId: owner.id, type: 'community_request' } });
    expect((req.payload as { user: { name: string } }).user.name).toBe('Deleted user');
    expect(JSON.stringify(await t.prisma.notification.findMany())).not.toContain('Leaving Person');
    expect(await t.prisma.notification.count({ where: { userId: leaver.id } })).toBe(0);
  });
});
