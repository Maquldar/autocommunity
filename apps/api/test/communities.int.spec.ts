import { COMMUNITY_LIMITS, type CommunityDto, type CommunityMemberDto } from '@autoc/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../src/common/ids';
import { bearer, createCommunity, createTestApp, createUser, setLocation, type TestApp } from './support/app';
import { pngImage } from './support/images';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

type U = { id: string; token: string };
let nameSeq = 0;
const uniqueName = (prefix = 'Club') => `${prefix} ${String(nameSeq++).padStart(4, '0')} ${newId().slice(-6)}`;

const c = (u: U) => ({
  create: (body: object) => request(t.http).post('/api/v1/communities').set(bearer(u.token)).send(body),
  get: (id: string) => request(t.http).get(`/api/v1/communities/${id}`).set(bearer(u.token)),
  list: (q = '') => request(t.http).get(`/api/v1/communities${q}`).set(bearer(u.token)),
  patch: (id: string, body: object) => request(t.http).patch(`/api/v1/communities/${id}`).set(bearer(u.token)).send(body),
  del: (id: string) => request(t.http).delete(`/api/v1/communities/${id}`).set(bearer(u.token)),
  join: (id: string) => request(t.http).post(`/api/v1/communities/${id}/join`).set(bearer(u.token)),
  leave: (id: string) => request(t.http).post(`/api/v1/communities/${id}/leave`).set(bearer(u.token)),
  members: (id: string, q = '') => request(t.http).get(`/api/v1/communities/${id}/members${q}`).set(bearer(u.token)),
  approve: (id: string, userId: string) => request(t.http).post(`/api/v1/communities/${id}/requests/${userId}/approve`).set(bearer(u.token)),
  reject: (id: string, userId: string) => request(t.http).post(`/api/v1/communities/${id}/requests/${userId}/reject`).set(bearer(u.token)),
  role: (id: string, userId: string, role: string) =>
    request(t.http).patch(`/api/v1/communities/${id}/members/${userId}`).set(bearer(u.token)).send({ role }),
  remove: (id: string, userId: string) => request(t.http).delete(`/api/v1/communities/${id}/members/${userId}`).set(bearer(u.token)),
  chat: (chatId: string) => request(t.http).get(`/api/v1/chats/${chatId}`).set(bearer(u.token)),
  send: (chatId: string, text = 'hi') => request(t.http).post(`/api/v1/chats/${chatId}/messages`).set(bearer(u.token)).send({ type: 'text', text }),
});

const memberCountConsistent = async (id: string) => {
  const [row, active] = await Promise.all([
    t.prisma.community.findUniqueOrThrow({ where: { id } }),
    t.prisma.communityMember.count({ where: { communityId: id, status: 'active' } }),
  ]);
  return { stored: row.memberCount, actual: active };
};

/** A community in every role: owner, moderator, member, pending, outsider (built through the API). */
async function rolesFixture(isPrivate = true) {
  const owner = await createUser(t);
  const moderator = await createUser(t);
  const member = await createUser(t);
  const pending = await createUser(t);
  const outsider = await createUser(t);
  const created = await c(owner).create({ name: uniqueName('Roles'), isPrivate }).expect(201);
  const id = created.body.id as string;
  for (const u of [moderator, member]) {
    const joined = await c(u).join(id).expect(200);
    if (joined.body.status === 'pending') await c(owner).approve(id, u.id).expect(204);
  }
  await c(owner).role(id, moderator.id, 'moderator').expect(204);
  if (isPrivate) expect((await c(pending).join(id).expect(200)).body).toEqual({ status: 'pending' });
  return { id, chatId: created.body.chatId as string, owner, moderator, member, pending, outsider };
}

describe('POST /communities', () => {
  it('creates the community, its chat and the owner membership', async () => {
    const owner = await createUser(t);
    const res = await c(owner).create({ name: '  Land Cruiser Club  ', description: 'Клуб владельцев LC', city: 'Almaty', isPrivate: false }).expect(201);
    const dto = res.body as CommunityDto;
    expect(dto).toMatchObject({
      name: 'Land Cruiser Club',
      description: 'Клуб владельцев LC',
      city: 'Almaty',
      isPrivate: false,
      memberCount: 1,
      ownerId: owner.id,
      avatarUrl: null,
      myMembership: { role: 'owner', status: 'active' },
    });
    expect(dto.chatId).toEqual(expect.any(String));
    expect(await t.prisma.chat.findUnique({ where: { id: dto.chatId! } })).toMatchObject({ type: 'community', refId: dto.id });
    expect(await t.prisma.chatMember.count({ where: { chatId: dto.chatId!, userId: owner.id } })).toBe(1);
    await c(owner).chat(dto.chatId!).expect(200);
  });

  it('validates input and the avatar upload', async () => {
    const u = await createUser(t);
    for (const body of [{ name: 'ab', isPrivate: false }, { name: 'x'.repeat(61), isPrivate: false }, { name: 'Ok name' }, { name: 'Ok name', isPrivate: false, city: 'Paris' }, { name: 'Ok name', isPrivate: false, description: 'x'.repeat(1001) }]) {
      expect((await c(u).create(body).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    }
    const png = await pngImage();
    const avatar = await request(t.http).post('/api/v1/uploads?purpose=avatar').set(bearer(u.token)).attach('file', png, { filename: 'a.png', contentType: 'image/png' }).expect(201);
    expect((await c(u).create({ name: uniqueName(), isPrivate: false, avatarUploadId: avatar.body.id }).expect(400)).body.error.code).toBe('INVALID_UPLOAD');
    const good = await request(t.http).post('/api/v1/uploads?purpose=community').set(bearer(u.token)).attach('file', png, { filename: 'a.png', contentType: 'image/png' }).expect(201);
    const res = await c(u).create({ name: uniqueName(), isPrivate: false, avatarUploadId: good.body.id }).expect(201);
    expect(res.body.avatarUrl).toBe(good.body.thumbUrl);
  });

  it('keeps names unique among live communities, case-insensitively', async () => {
    const a = await createUser(t);
    const b = await createUser(t);
    const name = uniqueName('Unique');
    const first = await c(a).create({ name, isPrivate: false }).expect(201);
    expect((await c(b).create({ name: name.toUpperCase(), isPrivate: false }).expect(409)).body.error.code).toBe('COMMUNITY_NAME_TAKEN');
    const other = await c(b).create({ name: uniqueName(), isPrivate: false }).expect(201);
    expect((await c(b).patch(other.body.id, { name: name.toLowerCase() }).expect(409)).body.error.code).toBe('COMMUNITY_NAME_TAKEN');
    // Concurrent creates of one name: exactly one wins.
    const race = uniqueName('Race');
    const results = await Promise.all([c(a).create({ name: race, isPrivate: false }), c(b).create({ name: race, isPrivate: true })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    // Deleting frees the name.
    await c(a).del(first.body.id).expect(204);
    await c(b).create({ name, isPrivate: false }).expect(201);
  });

  it(`limits ownership to ${COMMUNITY_LIMITS.ownedPerUser} communities`, async () => {
    const u = await createUser(t);
    for (let i = 0; i < COMMUNITY_LIMITS.ownedPerUser; i++) await createCommunity(t, u.id);
    expect((await c(u).create({ name: uniqueName(), isPrivate: false }).expect(409)).body.error.code).toBe('COMMUNITY_LIMIT');
    // Deleted ones don't count.
    const owned = await t.prisma.community.findFirstOrThrow({ where: { ownerId: u.id } });
    await c(u).del(owned.id).expect(204);
    await c(u).create({ name: uniqueName(), isPrivate: false }).expect(201);
  });
});

describe('joining and leaving', () => {
  it('public: join is active immediately with chat access; leave revokes it; memberCount follows', async () => {
    const owner = await createUser(t);
    const u = await createUser(t);
    const { body: com } = await c(owner).create({ name: uniqueName(), isPrivate: false }).expect(201);
    expect((await c(u).join(com.id).expect(200)).body).toEqual({ status: 'active' });
    const seen = (await c(u).get(com.id).expect(200)).body as CommunityDto;
    expect(seen).toMatchObject({ memberCount: 2, chatId: com.chatId, myMembership: { role: 'member', status: 'active' } });
    await c(u).send(com.chatId).expect(201);
    expect((await c(u).join(com.id).expect(409)).body.error.code).toBe('ALREADY_MEMBER');

    await c(u).leave(com.id).expect(204);
    expect((await c(u).get(com.id).expect(200)).body).toMatchObject({ memberCount: 1, chatId: null, myMembership: null });
    await c(u).chat(com.chatId).expect(404);
    await c(u).send(com.chatId).expect(404);
    await c(u).leave(com.id).expect(404);
    expect((await c(owner).leave(com.id).expect(400)).body.error.code).toBe('OWNER_CANNOT_LEAVE');
    // Rejoining works and history stays readable.
    await c(u).join(com.id).expect(200);
    expect((await request(t.http).get(`/api/v1/chats/${com.chatId}/messages`).set(bearer(u.token)).expect(200)).body.items).toHaveLength(1);
  });

  it('private: pending → moderators notified → approve → active + chat + notification; reject is silent', async () => {
    const owner = await createUser(t, { name: 'Owner' });
    const mod = await createUser(t);
    const asker = await createUser(t, { nickname: 'asker_x', name: 'Asker' });
    const rejected = await createUser(t);
    const id = await createCommunity(t, owner.id, [{ userId: mod.id, role: 'moderator' }], { isPrivate: true, name: uniqueName('Night') });
    const name = (await t.prisma.community.findUniqueOrThrow({ where: { id } })).name;

    expect((await c(asker).join(id).expect(200)).body).toEqual({ status: 'pending' });
    expect((await c(asker).get(id).expect(200)).body).toMatchObject({ chatId: null, memberCount: 2, myMembership: { role: 'member', status: 'pending' } });
    expect((await c(asker).join(id).expect(409)).body.error.code).toBe('ALREADY_MEMBER');
    for (const m of [owner, mod]) {
      const n = await t.prisma.notification.findFirstOrThrow({ where: { userId: m.id, type: 'community_request' } });
      expect(n.payload).toEqual({ communityId: id, communityName: name, user: { id: asker.id, nickname: 'asker_x', name: 'Asker', avatarUrl: null, rating: 50 } });
    }
    const pendingList = (await c(mod).members(id, '?status=pending').expect(200)).body.items as CommunityMemberDto[];
    expect(pendingList.map((m) => [m.user.id, m.status, m.joinedAt])).toEqual([[asker.id, 'pending', null]]);

    await c(mod).approve(id, asker.id).expect(204);
    const after = (await c(asker).get(id).expect(200)).body as CommunityDto;
    expect(after).toMatchObject({ memberCount: 3, myMembership: { status: 'active', role: 'member' } });
    await c(asker).chat(after.chatId!).expect(200);
    const approved = await t.prisma.notification.findFirstOrThrow({ where: { userId: asker.id, type: 'community_approved' } });
    expect(approved.payload).toEqual({ communityId: id, communityName: name });
    await c(mod).approve(id, asker.id).expect(404);

    await c(rejected).join(id).expect(200);
    await c(owner).reject(id, rejected.id).expect(204);
    expect(await t.prisma.communityMember.count({ where: { communityId: id, userId: rejected.id } })).toBe(0);
    expect(await t.prisma.notification.count({ where: { userId: rejected.id } })).toBe(0);
    await c(owner).reject(id, rejected.id).expect(404);
    // A pending user may cancel their request with leave.
    await c(rejected).join(id).expect(200);
    await c(rejected).leave(id).expect(204);
    expect(await memberCountConsistent(id)).toEqual({ stored: 3, actual: 3 });
  });

  it(`limits memberships (active + pending) to ${COMMUNITY_LIMITS.membershipsPerUser}`, async () => {
    const u = await createUser(t);
    const owner = await createUser(t);
    const ids: string[] = [];
    for (let i = 0; i < COMMUNITY_LIMITS.membershipsPerUser; i++) {
      ids.push(await createCommunity(t, owner.id, [{ userId: u.id, status: i % 2 ? 'pending' : 'active' }]));
    }
    const extra = await createCommunity(t, owner.id);
    expect((await c(u).join(extra).expect(409)).body.error.code).toBe('MEMBERSHIP_LIMIT');
    expect((await c(u).create({ name: uniqueName(), isPrivate: false }).expect(409)).body.error.code).toBe('MEMBERSHIP_LIMIT');
    await c(owner).del(ids[0]!).expect(204); // deleted communities don't count
    await c(u).join(extra).expect(200);
  });

  it('keeps memberCount consistent under concurrent joins and leaves', async () => {
    const owner = await createUser(t);
    const { body: com } = await c(owner).create({ name: uniqueName('Busy'), isPrivate: false }).expect(201);
    const users = await Promise.all(Array.from({ length: 20 }, () => createUser(t)));
    await Promise.all(users.map((u) => c(u).join(com.id)));
    expect(await memberCountConsistent(com.id)).toEqual({ stored: 21, actual: 21 });
    // Leaves, re-joins and duplicate joins racing each other.
    await Promise.all([
      ...users.slice(0, 10).map((u) => c(u).leave(com.id)),
      ...users.slice(10).map((u) => c(u).join(com.id)), // 409s
      ...users.slice(0, 5).map((u) => c(u).leave(com.id)), // racing the first leave: one 204, one 404
    ]);
    const after = await memberCountConsistent(com.id);
    expect(after).toEqual({ stored: 11, actual: 11 });
    const chat = await t.prisma.chatMember.count({ where: { chatId: com.chatId } });
    expect(chat).toBe(11);
  });

  it('404s for unknown or deleted communities', async () => {
    const u = await createUser(t);
    await c(u).get(newId()).expect(404);
    await c(u).join(newId()).expect(404);
    const deleted = await createCommunity(t, u.id, [], { deleted: true });
    await c(u).get(deleted).expect(404);
    await c(u).join(deleted).expect(404);
    await c(u).get('nope').expect(400);
  });
});

describe('authorization matrix (owner / moderator / member / pending / outsider)', () => {
  it('GET /communities/:id is visible to everyone; chatId only to active members', async () => {
    const f = await rolesFixture();
    for (const [u, active] of [[f.owner, true], [f.moderator, true], [f.member, true], [f.pending, false], [f.outsider, false]] as const) {
      const dto = (await c(u).get(f.id).expect(200)).body as CommunityDto;
      expect(dto.chatId !== null).toBe(active);
      expect(dto.name).toMatch(/^Roles/);
    }
  });

  it('PATCH: owner everything, moderator name/description/avatar only, others 403', async () => {
    const f = await rolesFixture();
    expect((await c(f.owner).patch(f.id, { description: 'by owner', isPrivate: false, city: 'Almaty' }).expect(200)).body).toMatchObject({
      description: 'by owner',
      isPrivate: false,
      city: 'Almaty',
    });
    await c(f.moderator).patch(f.id, { description: 'by mod', name: uniqueName('Renamed') }).expect(200);
    await c(f.moderator).patch(f.id, { isPrivate: true }).expect(403);
    await c(f.moderator).patch(f.id, { city: 'Astana' }).expect(403);
    for (const u of [f.member, f.pending, f.outsider]) await c(u).patch(f.id, { description: 'x' }).expect(403);
    expect((await c(f.outsider).get(f.id)).body.description).toBe('by mod');
  });

  it('members list: private → active members only; pending list → moderators only', async () => {
    const f = await rolesFixture(true);
    for (const u of [f.owner, f.moderator, f.member]) {
      const items = (await c(u).members(f.id).expect(200)).body.items as CommunityMemberDto[];
      expect(items.map((m) => m.user.id).sort()).toEqual([f.owner.id, f.moderator.id, f.member.id].sort());
      expect(items.find((m) => m.user.id === f.owner.id)?.role).toBe('owner');
    }
    for (const u of [f.pending, f.outsider]) await c(u).members(f.id).expect(403);
    for (const u of [f.owner, f.moderator]) {
      expect(((await c(u).members(f.id, '?status=pending').expect(200)).body.items as CommunityMemberDto[]).map((m) => m.user.id)).toEqual([f.pending.id]);
    }
    for (const u of [f.member, f.pending, f.outsider]) await c(u).members(f.id, '?status=pending').expect(403);

    const pub = await rolesFixture(false);
    await c(pub.outsider).members(pub.id).expect(200);
    await c(pub.outsider).members(pub.id, '?status=pending').expect(403);
  });

  it('approve / reject: moderators only', async () => {
    const f = await rolesFixture();
    for (const u of [f.member, f.pending, f.outsider]) {
      await c(u).approve(f.id, f.pending.id).expect(403);
      await c(u).reject(f.id, f.pending.id).expect(403);
    }
    await c(f.moderator).approve(f.id, f.pending.id).expect(204);
    const another = await createUser(t);
    await c(another).join(f.id).expect(200);
    await c(f.owner).reject(f.id, another.id).expect(204);
    await c(f.owner).approve(f.id, f.member.id).expect(404); // not pending
  });

  it('PATCH member role: owner only, with community_role notifications', async () => {
    const f = await rolesFixture();
    for (const u of [f.moderator, f.member, f.pending, f.outsider]) await c(u).role(f.id, f.member.id, 'moderator').expect(403);
    await c(f.owner).role(f.id, f.member.id, 'moderator').expect(204);
    await c(f.owner).role(f.id, f.member.id, 'moderator').expect(204); // no-op
    await c(f.owner).role(f.id, f.member.id, 'member').expect(204);
    const notes = await t.prisma.notification.findMany({ where: { userId: f.member.id, type: 'community_role' }, orderBy: { createdAt: 'asc' } });
    expect(notes.map((n) => (n.payload as { role: string }).role)).toEqual(['moderator', 'member']);
    await c(f.owner).role(f.id, f.pending.id, 'moderator').expect(404);
    await c(f.owner).role(f.id, f.outsider.id, 'moderator').expect(404);
    expect((await c(f.owner).role(f.id, f.owner.id, 'member').expect(400)).body.error.code).toBe('INVALID_TARGET');
    await c(f.owner).role(f.id, f.member.id, 'admin').expect(400);
  });

  it('DELETE member: moderators remove members and pending; only the owner removes moderators; nobody removes the owner', async () => {
    const f = await rolesFixture();
    for (const u of [f.member, f.pending, f.outsider]) await c(u).remove(f.id, f.member.id).expect(403);
    await c(f.moderator).remove(f.id, f.owner.id).expect(403);
    const mod2 = await createUser(t);
    await c(mod2).join(f.id).expect(200);
    await c(f.owner).approve(f.id, mod2.id).expect(204);
    await c(f.owner).role(f.id, mod2.id, 'moderator').expect(204);
    await c(f.moderator).remove(f.id, mod2.id).expect(403);
    await c(f.moderator).remove(f.id, f.pending.id).expect(204);
    const { body: before } = await c(f.member).get(f.id).expect(200);
    await c(f.moderator).remove(f.id, f.member.id).expect(204);
    expect((await c(f.member).get(f.id).expect(200)).body).toMatchObject({ myMembership: null, chatId: null, memberCount: before.memberCount - 1 });
    await c(f.member).chat(f.chatId).expect(404);
    await c(f.owner).remove(f.id, mod2.id).expect(204);
    await c(f.owner).remove(f.id, f.outsider.id).expect(404);
    expect((await c(f.moderator).remove(f.id, f.moderator.id).expect(400)).body.error.code).toBe('INVALID_TARGET');
    expect(await memberCountConsistent(f.id)).toEqual({ stored: 2, actual: 2 });
  });

  it('chat access follows active membership', async () => {
    const f = await rolesFixture();
    for (const u of [f.owner, f.moderator, f.member]) {
      await c(u).chat(f.chatId).expect(200);
      await c(u).send(f.chatId).expect(201);
    }
    for (const u of [f.pending, f.outsider]) {
      await c(u).chat(f.chatId).expect(404);
      await c(u).send(f.chatId).expect(404);
      await request(t.http).get(`/api/v1/chats/${f.chatId}/messages`).set(bearer(u.token)).expect(404);
    }
  });

  it('DELETE community: owner only; soft delete hides it and revokes chat access', async () => {
    const f = await rolesFixture();
    for (const u of [f.moderator, f.member, f.pending, f.outsider]) await c(u).del(f.id).expect(403);
    await c(f.member).send(f.chatId).expect(201);
    await c(f.owner).del(f.id).expect(204);
    expect(await t.prisma.community.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({ deletedAt: expect.any(Date) });
    for (const u of [f.owner, f.moderator, f.member]) {
      await c(u).get(f.id).expect(404);
      await c(u).chat(f.chatId).expect(404);
      expect(((await c(u).list('?mine=true').expect(200)).body.items as CommunityDto[]).some((x) => x.id === f.id)).toBe(false);
      const chats = (await request(t.http).get('/api/v1/chats').set(bearer(u.token)).expect(200)).body.items as { id: string }[];
      expect(chats.some((x) => x.id === f.chatId)).toBe(false);
    }
    await c(f.owner).del(f.id).expect(404);
    expect(await t.prisma.message.count({ where: { chatId: f.chatId } })).toBeGreaterThan(0); // history kept
  });
});

describe('ownership transfer', () => {
  it('makes the target the owner and the previous owner a moderator', async () => {
    const f = await rolesFixture();
    await c(f.owner).role(f.id, f.member.id, 'owner').expect(204);
    const dto = (await c(f.member).get(f.id).expect(200)).body as CommunityDto;
    expect(dto).toMatchObject({ ownerId: f.member.id, myMembership: { role: 'owner', status: 'active' } });
    expect((await c(f.owner).get(f.id).expect(200)).body.myMembership).toEqual({ role: 'moderator', status: 'active' });
    expect(await t.prisma.communityMember.count({ where: { communityId: f.id, role: 'owner' } })).toBe(1);
    const note = await t.prisma.notification.findFirstOrThrow({ where: { userId: f.member.id, type: 'community_role' } });
    expect((note.payload as { role: string }).role).toBe('owner');
    // The old owner can now leave; the new one can't; only the new one may delete.
    await c(f.owner).role(f.id, f.moderator.id, 'member').expect(403);
    await c(f.owner).del(f.id).expect(403);
    await c(f.owner).leave(f.id).expect(204);
    expect((await c(f.member).leave(f.id).expect(400)).body.error.code).toBe('OWNER_CANNOT_LEAVE');
    await c(f.member).role(f.id, f.moderator.id, 'member').expect(204);
    // Pending users can't receive ownership.
    await c(f.member).role(f.id, f.pending.id, 'owner').expect(404);
  });

  it(`refuses when the new owner already owns ${COMMUNITY_LIMITS.ownedPerUser}`, async () => {
    const owner = await createUser(t);
    const busy = await createUser(t);
    for (let i = 0; i < COMMUNITY_LIMITS.ownedPerUser; i++) await createCommunity(t, busy.id);
    const id = await createCommunity(t, owner.id, [{ userId: busy.id }]);
    expect((await c(owner).role(id, busy.id, 'owner').expect(409)).body.error.code).toBe('COMMUNITY_LIMIT');
  });
});

describe('GET /communities', () => {
  it('orders by memberCount desc then name, searches by substring, filters by city and mine, paginates', async () => {
    const viewer = await createUser(t);
    const owner = await createUser(t);
    const tag = `zq${newId().slice(-6)}`;
    const mk = async (name: string, members: number, city: string | null, isPrivate = false) => {
      const users = await Promise.all(Array.from({ length: members }, () => createUser(t)));
      const id = await createCommunity(t, owner.id, users.map((u) => ({ userId: u.id })), { name, isPrivate });
      if (city) await t.prisma.community.update({ where: { id }, data: { city } });
      return id;
    };
    const big = await mk(`Big ${tag}`, 4, 'Almaty');
    const b = await mk(`B ${tag} club`, 2, 'Astana');
    const a = await mk(`A ${tag} club`, 2, 'Almaty', true);
    const small = await mk(`${tag} small`, 0, null);
    await mk(`Gone ${tag}`, 0, null).then((id) => t.prisma.community.update({ where: { id }, data: { deletedAt: new Date() } }));

    const all = (await c(viewer).list(`?q=${tag.toUpperCase()}`).expect(200)).body.items as CommunityDto[];
    expect(all.map((x) => x.id)).toEqual([big, a, b, small]);
    // Private communities are listed with name/description/memberCount (no chat for non-members).
    expect(all[1]).toMatchObject({ isPrivate: true, memberCount: 3, chatId: null, myMembership: null });

    expect(((await c(viewer).list(`?q=${tag}&city=Almaty`).expect(200)).body.items as CommunityDto[]).map((x) => x.id)).toEqual([big, a]);
    expect((await c(viewer).list(`?q=${tag} club`).expect(200)).body.items.map((x: CommunityDto) => x.id)).toEqual([a, b]);
    await c(viewer).list('?city=Paris').expect(400);

    const pages: string[] = [];
    let cursor: string | null = null;
    do {
      const res: request.Response = await c(viewer).list(`?q=${tag}&limit=1${cursor ? `&cursor=${cursor}` : ''}`).expect(200);
      pages.push(...res.body.items.map((x: CommunityDto) => x.id));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(pages).toEqual([big, a, b, small]);
    await c(viewer).list('?cursor=bad').expect(400);

    // mine=true: active and pending memberships.
    await c(viewer).join(b).expect(200);
    await c(viewer).join(a).expect(200); // private → pending
    const mine = (await c(viewer).list('?mine=true').expect(200)).body.items as CommunityDto[];
    // b now has 4 members (viewer joined), a still 3.
    expect(mine.map((x) => [x.id, x.myMembership?.status])).toEqual([
      [b, 'active'],
      [a, 'pending'],
    ]);
  });

  it('escapes LIKE wildcards in q', async () => {
    const u = await createUser(t);
    const tag = `wc${newId().slice(-6)}`;
    await createCommunity(t, u.id, [], { name: `${tag} 100% club` });
    await createCommunity(t, u.id, [], { name: `${tag} 1000 club` });
    expect((await c(u).list(`?q=${encodeURIComponent(`${tag} 100%`)}`).expect(200)).body.items).toHaveLength(1);
  });
});

describe('map communityIds with real memberships', () => {
  it('filters by communities the viewer joined through the API and rejects others', async () => {
    const viewer = await createUser(t);
    const owner = await createUser(t, { privacyMode: 'community' });
    const stranger = await createUser(t, { privacyMode: 'everyone' });
    const { body: com } = await c(owner).create({ name: uniqueName('Map'), isPrivate: true }).expect(201);
    await setLocation(t, owner.id, 43.25, 76.92, 1);
    await setLocation(t, stranger.id, 43.251, 76.921, 1);
    const bbox = 'bbox=76.9,43.24,76.94,43.26';
    await request(t.http).get(`/api/v1/map/users?${bbox}&communityIds=${com.id}`).set(bearer(viewer.token)).expect(403);
    await c(viewer).join(com.id).expect(200);
    await request(t.http).get(`/api/v1/map/users?${bbox}&communityIds=${com.id}`).set(bearer(viewer.token)).expect(403); // pending
    await c(owner).approve(com.id, viewer.id).expect(204);
    const res = await request(t.http).get(`/api/v1/map/users?${bbox}&communityIds=${com.id}`).set(bearer(viewer.token)).expect(200);
    expect(res.body.items.map((i: { userId: string; relation: string }) => [i.userId, i.relation])).toEqual([[owner.id, 'community']]);
    await c(viewer).leave(com.id).expect(204);
    await request(t.http).get(`/api/v1/map/users?${bbox}&communityIds=${com.id}`).set(bearer(viewer.token)).expect(403);
  });
});

describe('account deletion', () => {
  it('leaves communities (memberCount kept) and closes owned ones', async () => {
    const owner = await createUser(t);
    const leaver = await createUser(t);
    const other = await c(owner).create({ name: uniqueName(), isPrivate: false }).expect(201);
    await c(leaver).join(other.body.id).expect(200);
    const own = await c(leaver).create({ name: uniqueName(), isPrivate: false }).expect(201);
    await c(owner).join(own.body.id).expect(200);
    await request(t.http).delete('/api/v1/me').set(bearer(leaver.token)).send({ confirm: 'DELETE' }).expect(204);
    expect(await memberCountConsistent(other.body.id)).toEqual({ stored: 1, actual: 1 });
    await c(owner).get(own.body.id).expect(404);
    await c(owner).chat(own.body.chatId).expect(404);
  });
});
