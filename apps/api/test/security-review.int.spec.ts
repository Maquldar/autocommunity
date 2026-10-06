import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ANTIFRAUD,
  EVENT_LIMITS,
  FEED_LIMITS,
  type AdminReportDto,
  type AdminResolveResult,
  type EventDto,
  type Paginated,
  type PostCommentDto,
  type PostDto,
  type UploadDto,
} from '@autoc/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { newId } from '../src/common/ids';
import { BackgroundTasks } from '../src/infra/tasks/background-tasks';
import { AdminAuditService } from '../src/modules/admin/admin-audit.service';
import { AntifraudService } from '../src/modules/antifraud/antifraud.service';
import { EventsService } from '../src/modules/events/events.service';
import { FeedService } from '../src/modules/feed/feed.service';
import { loadRatingInput } from '../src/modules/rating/rating-input';
import { RealtimeService } from '../src/modules/realtime/realtime.service';
import { UPLOAD_DAILY_BYTES } from '../src/modules/uploads/upload-stream.interceptor';
import { UploadsCleanupService } from '../src/modules/uploads/uploads-cleanup.service';
import { bearer, createCommunity, createTestApp, createUser, setLocation, type TestApp } from './support/app';
import { pngImage } from './support/images';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ SOS_EXPAND_DELAY_MS: '3600000' });
});
afterAll(async () => {
  await t.close();
});

type U = { id: string; token: string };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOTE = 'Нарушение правил сообщества';
const drain = () => t.app.get(BackgroundTasks).drain();
const inHours = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const as = (u: U) => ({
  get: (path: string) => request(t.http).get(`/api/v1${path}`).set(bearer(u.token)),
  post: (path: string, body: object = {}) => request(t.http).post(`/api/v1${path}`).set(bearer(u.token)).send(body),
  patch: (path: string, body: object = {}) => request(t.http).patch(`/api/v1${path}`).set(bearer(u.token)).send(body),
  del: (path: string, body: object = {}) => request(t.http).delete(`/api/v1${path}`).set(bearer(u.token)).send(body),
});
const admin = () => createUser(t, { role: 'admin', nickname: `adm_${newId().slice(-8)}` });
const eventBody = (over: Record<string, unknown> = {}) => ({
  title: 'Встреча клуба',
  description: '',
  place: 'Парковка',
  lat: 43.2333,
  lng: 76.9566,
  startsAt: inHours(24),
  ...over,
});

/** An event of `communityId` created through the API by `creator`, with `going` users RSVPed going. */
async function eventWithGoing(creator: U, communityId: string, going: U[]): Promise<{ eventId: string; chatId: string }> {
  const ev = (await as(creator).post(`/communities/${communityId}/events`, eventBody()).expect(201)).body as EventDto;
  let chatId = '';
  for (const u of going) chatId = ((await as(u).post(`/events/${ev.id}/rsvp`, { status: 'going' }).expect(200)).body as EventDto).chatId!;
  return { eventId: ev.id, chatId };
}

/* ------------------------------------------------------------------ H1 */

describe('H1: event chats and notices follow community membership', () => {
  it('leaving a private community drops the RSVP, goingCount and the event chat (sockets leave the room)', async () => {
    const owner = await createUser(t);
    const member = await createUser(t);
    const other = await createUser(t);
    const communityId = await createCommunity(t, owner.id, [{ userId: member.id }, { userId: other.id }], { isPrivate: true });
    const { eventId, chatId } = await eventWithGoing(owner, communityId, [member, other]);
    expect((await t.prisma.event.findUniqueOrThrow({ where: { id: eventId } })).goingCount).toBe(2);
    await as(member).get(`/chats/${chatId}/messages`).expect(200);

    const leaveChat = vi.spyOn(t.app.get(RealtimeService), 'leaveChat');
    await as(member).post(`/communities/${communityId}/leave`).expect(204);
    expect(leaveChat).toHaveBeenCalledWith([member.id], chatId);
    leaveChat.mockRestore();

    expect(await t.prisma.eventParticipant.count({ where: { eventId, userId: member.id } })).toBe(0);
    expect((await t.prisma.event.findUniqueOrThrow({ where: { id: eventId } })).goingCount).toBe(1);
    expect(await t.prisma.chatMember.count({ where: { chatId, userId: member.id } })).toBe(0);
    await as(member).get(`/chats/${chatId}`).expect(404);
    await as(member).get(`/chats/${chatId}/messages`).expect(404);
    await as(member).post(`/chats/${chatId}/messages`, { type: 'text', text: 'ещё тут?' }).expect(404);
    // The others are unaffected.
    await as(other).get(`/chats/${chatId}/messages`).expect(200);
  });

  it('removal by a moderator does the same; community deletion drops every participant and event chat', async () => {
    const owner = await createUser(t);
    const member = await createUser(t);
    const other = await createUser(t);
    const communityId = await createCommunity(t, owner.id, [{ userId: member.id }, { userId: other.id }]);
    const { eventId, chatId } = await eventWithGoing(owner, communityId, [member, other, owner]);
    await as(owner).del(`/communities/${communityId}/members/${member.id}`).expect(204);
    expect(await t.prisma.eventParticipant.count({ where: { eventId } })).toBe(2);
    expect((await t.prisma.event.findUniqueOrThrow({ where: { id: eventId } })).goingCount).toBe(2);
    await as(member).get(`/chats/${chatId}`).expect(404);

    const leaveChat = vi.spyOn(t.app.get(RealtimeService), 'leaveChat');
    await as(owner).del(`/communities/${communityId}`).expect(204);
    expect(leaveChat).toHaveBeenCalledWith(expect.arrayContaining([owner.id, other.id]), chatId);
    leaveChat.mockRestore();
    expect(await t.prisma.eventParticipant.count({ where: { eventId } })).toBe(0);
    expect(await t.prisma.chatMember.count({ where: { chatId } })).toBe(0);
    await as(other).get(`/chats/${chatId}`).expect(404);
  });

  it('a leftover chat membership gives no access once the community is private and the user no member, or deleted', async () => {
    const owner = await createUser(t);
    const ex = await createUser(t);
    const communityId = await createCommunity(t, owner.id, [], { isPrivate: true });
    const { eventId, chatId } = await eventWithGoing(owner, communityId, [owner]);
    // Simulates state from before the fix: a chat member and participant who is not in the community.
    await t.prisma.chatMember.create({ data: { chatId, userId: ex.id } });
    await t.prisma.eventParticipant.create({ data: { eventId, userId: ex.id, status: 'going' } });
    await as(ex).get(`/chats/${chatId}`).expect(404);
    await as(ex).get(`/chats/${chatId}/messages`).expect(404);
    const list = (await as(ex).get('/chats').expect(200)).body as Paginated<{ id: string }>;
    expect(list.items.map((c) => c.id)).not.toContain(chatId);

    // ...and they get neither change notices nor reminders.
    await as(owner).patch(`/events/${eventId}`, { title: 'Новое название' }).expect(200);
    await drain();
    expect(await t.prisma.notification.count({ where: { userId: ex.id, type: 'event_new' } })).toBe(0);
    const ev = await t.prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    const reminded = await t.app.get(EventsService).remind({ eventId, startsAt: ev.startsAt.toISOString() });
    expect(reminded).toBe(1);
    expect(await t.prisma.notification.count({ where: { userId: ex.id, type: 'event_reminder' } })).toBe(0);
    expect(await t.prisma.notification.count({ where: { userId: owner.id, type: 'event_reminder' } })).toBe(1);

    // The owner keeps access until the community is deleted (directly, as a stale state).
    await as(owner).get(`/chats/${chatId}`).expect(200);
    await t.prisma.community.update({ where: { id: communityId }, data: { deletedAt: new Date() } });
    await as(owner).get(`/chats/${chatId}`).expect(404);
  });

  it('"event updated" notices are throttled to one per event per 10 min', async () => {
    const owner = await createUser(t);
    const member = await createUser(t);
    const communityId = await createCommunity(t, owner.id, [{ userId: member.id }]);
    const { eventId } = await eventWithGoing(owner, communityId, [member]);
    await as(owner).patch(`/events/${eventId}`, { title: 'Первая правка' }).expect(200);
    await as(owner).patch(`/events/${eventId}`, { title: 'Вторая правка' }).expect(200);
    await drain();
    const updated = await t.prisma.notification.findMany({ where: { userId: member.id, type: 'event_new', payload: { path: ['change'], equals: 'updated' } } });
    expect(updated).toHaveLength(1);
    expect(await t.redis.ttl(`notify:event_updated:${eventId}`)).toBeGreaterThan(EVENT_LIMITS.updateNotifyThrottleSec - 10);
  });
});

/* ------------------------------------------------------------------ M3 */

describe('M3: an event creator who left the community no longer manages the event', () => {
  it('PATCH / DELETE → 403 and canManage false once the creator is not an active member', async () => {
    const owner = await createUser(t);
    const mod = await createUser(t);
    const communityId = await createCommunity(t, owner.id, [{ userId: mod.id, role: 'moderator' }]);
    const ev = (await as(mod).post(`/communities/${communityId}/events`, eventBody()).expect(201)).body as EventDto;
    await as(mod).post(`/communities/${communityId}/leave`).expect(204);
    expect(((await as(mod).get(`/events/${ev.id}`).expect(200)).body as EventDto).canManage).toBe(false);
    await as(mod).patch(`/events/${ev.id}`, { title: 'Ушёл, но правлю' }).expect(403);
    await as(mod).del(`/events/${ev.id}`).expect(403);
    await as(owner).patch(`/events/${ev.id}`, { title: 'Правка владельца' }).expect(200);
  });
});

/* ------------------------------------------------------------------ H2 + L3 */

describe('H2/L3: admins review and remove reported posts and comments', () => {
  async function reportedPost() {
    const owner = await createUser(t);
    const author = await createUser(t);
    const reporter = await createUser(t);
    const communityId = await createCommunity(t, owner.id, [{ userId: author.id }, { userId: reporter.id }], { isPrivate: true, name: `Закрытый ${newId().slice(-6)}` });
    const img = (await request(t.http).post('/api/v1/uploads?purpose=post').set(bearer(author.token)).attach('file', await pngImage(64), 'p.png').expect(201))
      .body as UploadDto;
    const post = (await as(author).post('/posts', { communityId, text: 'Продаю права', mediaUploadIds: [img.id] }).expect(201)).body as PostDto;
    const comment = (await as(author).post(`/posts/${post.id}/comments`, { text: 'Пишите в личку' }).expect(201)).body as PostCommentDto;
    const postReport = (await as(reporter).post('/reports', { targetType: 'post', targetId: post.id, reason: 'spam' }).expect(201)).body.id as string;
    const commentReport = (await as(reporter).post('/reports', { targetType: 'comment', targetId: comment.id, reason: 'spam' }).expect(201)).body.id as string;
    return { author, reporter, communityId, post, comment, img, postReport, commentReport };
  }

  it('previews carry text, the first image, postId and deleted; admins (only) read the post and its comments', async () => {
    const a = await admin();
    const outsider = await createUser(t);
    const { post, comment, img, postReport, commentReport } = await reportedPost();
    const list = (await as(a).get('/admin/reports?status=open&limit=50').expect(200)).body as Paginated<AdminReportDto>;
    const pr = list.items.find((r) => r.id === postReport)!;
    const cr = list.items.find((r) => r.id === commentReport)!;
    expect(pr.preview).toMatchObject({ text: 'Продаю права', deleted: false, postId: post.id });
    expect(pr.preview.imageUrl).toBe(img.thumbUrl ?? img.url);
    expect(cr.preview).toMatchObject({ text: 'Пишите в личку', deleted: false, imageUrl: null, postId: post.id });

    await as(outsider).get(`/posts/${post.id}`).expect(404);
    await as(outsider).get(`/posts/${post.id}/comments`).expect(404);
    expect(((await as(a).get(`/posts/${post.id}`).expect(200)).body as PostDto).text).toBe('Продаю права');
    const comments = (await as(a).get(`/posts/${post.id}/comments`).expect(200)).body as Paginated<PostCommentDto>;
    expect(comments.items.map((c) => c.id)).toEqual([comment.id]);
  });

  it('confirm + removeContent soft-deletes the comment (commentCount −1) and the post, with audit rows', async () => {
    const a = await admin();
    const { author, post, comment, postReport, commentReport } = await reportedPost();
    const rc = (await as(a).post(`/admin/reports/${commentReport}/resolve`, { decision: 'confirm', note: NOTE, removeContent: true }).expect(200))
      .body as AdminResolveResult;
    expect(rc).toMatchObject({ contentRemoved: true, penaltyApplied: true });
    expect(rc.report.preview).toMatchObject({ deleted: true, postId: post.id });
    expect((await t.prisma.postComment.findUniqueOrThrow({ where: { id: comment.id } })).deletedAt).not.toBeNull();
    expect((await t.prisma.post.findUniqueOrThrow({ where: { id: post.id } })).commentCount).toBe(0);

    const rp = (await as(a).post(`/admin/reports/${postReport}/resolve`, { decision: 'confirm', note: NOTE, removeContent: true }).expect(200))
      .body as AdminResolveResult;
    expect(rp).toMatchObject({ contentRemoved: true, report: { preview: { deleted: true, postId: post.id } } });
    await as(author).get(`/posts/${post.id}`).expect(404);

    const audit = await t.prisma.adminAction.findMany({ where: { adminId: a.id }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((r) => [r.action, r.targetType, r.targetId])).toEqual([
      ['report.confirm', 'report', commentReport],
      ['report.remove_content', 'comment', comment.id],
      ['report.confirm', 'report', postReport],
      ['report.remove_content', 'post', post.id],
    ]);
  });

  it('a failing removal rolls back the whole resolution (report stays open, no penalty, no audit); a retry works', async () => {
    const a = await admin();
    const { author, post, postReport } = await reportedPost();
    const feed = t.app.get(FeedService);
    const spy = vi.spyOn(feed, 'removePostAsAdmin').mockRejectedValueOnce(new Error('storage down'));
    await as(a).post(`/admin/reports/${postReport}/resolve`, { decision: 'confirm', note: NOTE, removeContent: true }).expect(500);
    spy.mockRestore();
    expect((await t.prisma.report.findUniqueOrThrow({ where: { id: postReport } })).status).toBe('open');
    expect(await t.prisma.adminAction.count({ where: { adminId: a.id } })).toBe(0);
    expect(await t.prisma.ratingEvent.count({ where: { userId: author.id, reason: 'penalty' } })).toBe(0);
    expect((await t.prisma.post.findUniqueOrThrow({ where: { id: post.id } })).deletedAt).toBeNull();

    await as(a).post(`/admin/reports/${postReport}/resolve`, { decision: 'confirm', note: NOTE, removeContent: true }).expect(200);
    expect((await t.prisma.post.findUniqueOrThrow({ where: { id: post.id } })).deletedAt).not.toBeNull();
    expect(await t.prisma.ratingEvent.count({ where: { userId: author.id, reason: 'penalty' } })).toBe(1);
  });

  it('admin community delete: the audit row commits with the deletion', async () => {
    const a = await admin();
    const owner = await createUser(t);
    const communityId = await createCommunity(t, owner.id);
    const spy = vi.spyOn(t.app.get(AdminAuditService), 'record').mockRejectedValueOnce(new Error('audit down'));
    await as(a).del(`/admin/communities/${communityId}`, { note: NOTE }).expect(500);
    spy.mockRestore();
    expect((await t.prisma.community.findUniqueOrThrow({ where: { id: communityId } })).deletedAt).toBeNull();
    await as(a).del(`/admin/communities/${communityId}`, { note: NOTE }).expect(204);
    expect((await t.prisma.community.findUniqueOrThrow({ where: { id: communityId } })).deletedAt).not.toBeNull();
    expect(await t.prisma.adminAction.count({ where: { targetId: communityId, action: 'community.delete' } })).toBe(1);
  });
});

/* ------------------------------------------------------------------ L1 */

describe('L1: admins never moderate other admins’ services or visits', () => {
  it('a service submitted by another admin, or a visit by one → 403 INVALID_TARGET', async () => {
    const a = await admin();
    const b = await admin();
    const serviceId = newId();
    await t.prisma.$executeRaw`
      INSERT INTO service_centers (id, name, category, address, location, status, qr_secret, submitted_by_id, updated_at)
      VALUES (${serviceId}::uuid, 'Сервис админа', 'repair', 'ул. Абая 1', ST_SetSRID(ST_MakePoint(76.9, 43.24), 4326)::geography,
              'pending'::"ServiceStatus", 'secret-qr', ${b.id}::uuid, now())`;
    expect((await as(a).post(`/admin/services/${serviceId}/verify`, { note: NOTE }).expect(403)).body.error.code).toBe('INVALID_TARGET');
    const visitId = newId();
    await t.prisma.serviceVisit.create({ data: { id: visitId, serviceId, userId: b.id, method: 'photo', status: 'pending' } });
    expect((await as(a).post(`/admin/visits/${visitId}/approve`, { note: NOTE }).expect(403)).body.error.code).toBe('INVALID_TARGET');
  });
});

/* ------------------------------------------------------------------ M1 */

describe('M1: report_burst counts only credible reporters and fires once', () => {
  const oldUser = async (data: { rating?: number; createdAt?: Date } = {}) => {
    const u = await createUser(t);
    await t.prisma.user.update({ where: { id: u.id }, data: { createdAt: data.createdAt ?? new Date(Date.now() - 30 * DAY), rating: data.rating ?? 50 } });
    return u;
  };
  const reportUser = (reporter: U, targetId: string) => as(reporter).post('/reports', { targetType: 'user', targetId, reason: 'harassment' }).expect(201);
  const flags = (userId: string) => t.prisma.fraudFlag.findMany({ where: { userId, kind: 'report_burst' } });

  it('new accounts, low-rated reporters and reporters with dismissed reports do not count', async () => {
    const target = await oldUser({ rating: ANTIFRAUD.reportBurstBlockBelowRating - 5 });
    const fresh = await oldUser({ createdAt: new Date(Date.now() - (ANTIFRAUD.reportBurstReporterMinAgeDays * DAY - HOUR)) });
    const lowRated = await oldUser({ rating: ANTIFRAUD.reportBurstReporterMinRating - 1 });
    const dismissed = await oldUser();
    const someone = await oldUser();
    const old = (await reportUser(dismissed, someone.id)).body.id as string;
    await t.prisma.report.update({ where: { id: old }, data: { status: 'dismissed', resolvedAt: new Date() } });
    const credible = await oldUser();
    for (const r of [fresh, lowRated, dismissed, credible]) await reportUser(r, target.id);
    await drain();
    expect(await flags(target.id)).toHaveLength(0);
    expect((await t.prisma.user.findUniqueOrThrow({ where: { id: target.id } })).status).toBe('active');

    await reportUser(await oldUser(), target.id);
    await drain();
    expect(await flags(target.id)).toHaveLength(0);
    await reportUser(await oldUser(), target.id);
    await drain();
    expect(await flags(target.id)).toHaveLength(1);
    expect((await flags(target.id))[0]!.details).toMatchObject({ reporters: 3 });
    expect((await t.prisma.user.findUniqueOrThrow({ where: { id: target.id } })).status).toBe('blocked');
  });

  it('concurrent checks produce one flag and one block', async () => {
    const target = await oldUser({ rating: ANTIFRAUD.reportBurstBlockBelowRating - 5 });
    for (let i = 0; i < 3; i++) {
      const r = await oldUser();
      await t.prisma.report.create({ data: { id: newId(), reporterId: r.id, targetType: 'user', targetId: target.id, targetUserId: target.id, reason: 'spam' } });
    }
    const antifraud = t.app.get(AntifraudService);
    const results = await Promise.all(Array.from({ length: 6 }, () => antifraud.checkReportBurst(target.id)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await flags(target.id)).toHaveLength(1);
    expect(await t.prisma.notification.count({ where: { userId: target.id, type: 'admin_warning' } })).toBe(1);
  });
});

/* ------------------------------------------------------------------ M2 */

describe('M2: rating farming', () => {
  let areaSeq = 0;
  /** A closed SOS by `requester` where `helper` arrived, closed `daysAgo` days ago. */
  async function helpedSos(requester: string, helper: string, daysAgo: number, opts: { fake?: boolean; stars?: number } = {}): Promise<string> {
    const id = newId();
    const closedAt = new Date(Date.now() - daysAgo * DAY);
    const lat = 50 + areaSeq++ * 0.01;
    await t.prisma.$executeRaw`
      INSERT INTO sos_requests (id, user_id, type, location, status, is_fake, created_at, closed_at, expires_at, updated_at)
      VALUES (${id}::uuid, ${requester}::uuid, 'battery', ST_SetSRID(ST_MakePoint(10::float8, ${lat}::float8), 4326)::geography,
              'closed', ${opts.fake ?? false}, ${new Date(closedAt.getTime() - HOUR)}, ${closedAt}, ${closedAt}, now())`;
    await t.prisma.sosResponse.create({ data: { id: newId(), sosId: id, helperId: helper, status: 'arrived' } });
    if (opts.stars) {
      await t.prisma.review.create({
        data: { id: newId(), authorId: requester, targetType: 'user', targetId: helper, refId: id, stars: opts.stars, createdAt: closedAt },
      });
    }
    return id;
  }

  it('fake SOS count neither as helps nor reviews; each counterpart counts once per 30 days', async () => {
    const helper = await createUser(t);
    const friend = await createUser(t);
    const stranger = await createUser(t);
    await helpedSos(friend.id, helper.id, 1, { stars: 5 });
    await helpedSos(friend.id, helper.id, 5, { stars: 5 }); // same counterpart within 30 days
    await helpedSos(friend.id, helper.id, 40, { stars: 4 }); // > 30 days before the next → counts
    await helpedSos(stranger.id, helper.id, 2, { fake: true, stars: 5 });
    const input = (await loadRatingInput(t.prisma, helper.id, new Date()))!;
    expect(input.helps).toHaveLength(2);
    expect(input.reviewStars.sort()).toEqual([4, 5]);
  });

  it('marking an SOS fake recomputes the helpers’ ratings', async () => {
    const a = await admin();
    const requester = await createUser(t);
    const helper = await createUser(t);
    const sosId = await helpedSos(requester.id, helper.id, 1, { stars: 5 });
    // Bring the cached rating in line with the help first.
    await as(helper).get('/me/rating').expect(200);
    const before = (await t.prisma.user.findUniqueOrThrow({ where: { id: helper.id } })).rating;
    expect(before).toBeGreaterThan(50);
    await as(a).post(`/admin/sos/${sosId}/mark-fake`, { note: NOTE }).expect(200);
    const after = (await t.prisma.user.findUniqueOrThrow({ where: { id: helper.id } })).rating;
    expect(after).toBeLessThan(before);
    expect(await t.prisma.ratingEvent.count({ where: { userId: helper.id, reason: 'recalc', refId: sosId } })).toBe(1);
  });

  it('reciprocal_sos: two users helping each other twice within 7 days are flagged once', async () => {
    const x = await createUser(t);
    const y = await createUser(t);
    const antifraud = t.app.get(AntifraudService);
    const first = await helpedSos(x.id, y.id, 2);
    expect(await antifraud.checkReciprocalSos(x.id, y.id, first)).toBe(false);
    const second = await helpedSos(y.id, x.id, 1);
    expect(await antifraud.checkReciprocalSos(y.id, x.id, second)).toBe(true);
    expect(await antifraud.checkReciprocalSos(x.id, y.id, second)).toBe(false);
    const rows = await t.prisma.fraudFlag.findMany({ where: { kind: 'reciprocal_sos', userId: { in: [x.id, y.id] } } });
    expect(rows.map((r) => r.userId).sort()).toEqual([x.id, y.id].sort());
    expect(rows[0]!.details).toMatchObject({ helps: 2 });
  });
});

/* ------------------------------------------------------------------ M4 */

describe('M4: upload limits and orphan cleanup', () => {
  it('without ?purpose the image cap applies (not the video cap)', async () => {
    const u = await createUser(t);
    const big = Buffer.alloc(11 * 1024 * 1024, 1);
    const res = await request(t.http).post('/api/v1/uploads').set(bearer(u.token)).field('purpose', 'post').attach('file', big, 'big.png');
    expect(res.status).toBe(413);
  });

  it('at most 2 uploads in flight per user → 429; the slot is released after each upload', async () => {
    const u = await createUser(t);
    await t.redis.set(`upload:inflight:${u.id}`, '2', 'EX', 60);
    const res = await request(t.http).post('/api/v1/uploads?purpose=post').set(bearer(u.token)).attach('file', await pngImage(), 'a.png').expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(await t.redis.get(`upload:inflight:${u.id}`)).toBe('2');
    await t.redis.del(`upload:inflight:${u.id}`);
    await request(t.http).post('/api/v1/uploads?purpose=post').set(bearer(u.token)).attach('file', await pngImage(), 'a.png').expect(201);
    expect(await t.redis.get(`upload:inflight:${u.id}`)).toBe('0');
  });

  it('a daily byte quota per user → 429', async () => {
    const u = await createUser(t);
    await t.prisma.upload.create({
      data: { id: newId(), ownerId: u.id, purpose: 'video', key: `video/q-${newId()}.mp4`, mime: 'video/mp4', sizeBytes: UPLOAD_DAILY_BYTES },
    });
    const res = await request(t.http).post('/api/v1/uploads?purpose=post').set(bearer(u.token)).attach('file', await pngImage(), 'a.png').expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.body.error.details.retryAfterSec).toBeGreaterThan(0);
  });

  it('deletes uploads left unattached for more than 24 h (row and file); attached ones stay', async () => {
    const u = await createUser(t);
    const upload = async () =>
      ((await request(t.http).post('/api/v1/uploads?purpose=avatar').set(bearer(u.token)).attach('file', await pngImage(), 'a.png').expect(201)).body as UploadDto);
    const orphan = await upload();
    const avatar = await upload();
    const recent = await upload();
    await as(u).patch('/me', { avatarUploadId: avatar.id }).expect(200);
    const old = new Date(Date.now() - 25 * HOUR);
    await t.prisma.upload.updateMany({ where: { id: { in: [orphan.id, avatar.id] } }, data: { createdAt: old } });
    const orphanRow = await t.prisma.upload.findUniqueOrThrow({ where: { id: orphan.id } });
    const file = join(tmpdir(), 'autoc-api-test-uploads', orphanRow.key);
    expect(existsSync(file)).toBe(true);

    expect(await t.app.get(UploadsCleanupService).purge()).toBeGreaterThanOrEqual(1);
    expect(await t.prisma.upload.findUnique({ where: { id: orphan.id } })).toBeNull();
    expect(existsSync(file)).toBe(false);
    expect(await t.prisma.upload.findUnique({ where: { id: avatar.id } })).not.toBeNull();
    expect(await t.prisma.upload.findUnique({ where: { id: recent.id } })).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ M5 / L6 */

describe('M5/L6: rate limits', () => {
  it(`event create: ${EVENT_LIMITS.createsPerDay}/day per user`, async () => {
    const owner = await createUser(t);
    const communityId = await createCommunity(t, owner.id);
    for (let i = 0; i < EVENT_LIMITS.createsPerDay; i++) await as(owner).post(`/communities/${communityId}/events`, eventBody()).expect(201);
    expect((await as(owner).post(`/communities/${communityId}/events`, eventBody()).expect(429)).body.error.code).toBe('RATE_LIMITED');
  });

  it(`event patch: ${EVENT_LIMITS.updatesPerHour}/h; RSVP: ${EVENT_LIMITS.rsvpsPerMinute}/min`, async () => {
    const owner = await createUser(t);
    const member = await createUser(t);
    const communityId = await createCommunity(t, owner.id, [{ userId: member.id }]);
    const ev = (await as(owner).post(`/communities/${communityId}/events`, eventBody()).expect(201)).body as EventDto;
    for (let i = 0; i < EVENT_LIMITS.updatesPerHour; i++) await as(owner).patch(`/events/${ev.id}`, { title: `Правка ${i}` }).expect(200);
    await as(owner).patch(`/events/${ev.id}`, { title: 'Лишняя' }).expect(429);
    for (let i = 0; i < EVENT_LIMITS.rsvpsPerMinute; i++) await as(member).post(`/events/${ev.id}/rsvp`, { status: i % 2 ? 'none' : 'going' }).expect(200);
    await as(member).post(`/events/${ev.id}/rsvp`, { status: 'interested' }).expect(429);
  });

  it(`likes: ${FEED_LIMITS.likesPerMinute}/min (like + unlike); /map/events: ${EVENT_LIMITS.mapRequestsPerMinute}/min`, async () => {
    const u = await createUser(t);
    const post = (await as(u).post('/posts', { text: 'Привет' }).expect(201)).body as PostDto;
    for (let i = 0; i < FEED_LIMITS.likesPerMinute; i++) {
      if (i % 2) await as(u).del(`/posts/${post.id}/like`).expect(200);
      else await as(u).post(`/posts/${post.id}/like`).expect(200);
    }
    await as(u).post(`/posts/${post.id}/like`).expect(429);
    const bbox = '76.8,43.1,77.1,43.4';
    for (let i = 0; i < EVENT_LIMITS.mapRequestsPerMinute; i++) await as(u).get(`/map/events?bbox=${bbox}`).expect(200);
    await as(u).get(`/map/events?bbox=${bbox}`).expect(429);
  });
});

/* ------------------------------------------------------------------ L4 */

describe('L4: public SOS link', () => {
  it('the public SOS JSON is not cacheable', async () => {
    const u = await createUser(t);
    await setLocation(t, u.id, 60, 60, 1);
    const sos = (await as(u).post('/sos', { type: 'battery', description: 'Сел аккумулятор', lat: 60, lng: 60, sharePhone: false }).expect(201)).body as { id: string };
    const { url } = (await as(u).post(`/sos/${sos.id}/share`).expect(200)).body as { url: string };
    const token = url.split('/s/')[1]!;
    const res = await request(t.http).get(`/api/v1/public/sos/${token}`).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
