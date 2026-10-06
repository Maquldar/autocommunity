import type { RatingDto, RatingEventDto, ReviewDto, SosDto } from '@autoc/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../src/common/ids';
import { RatingDailyService, RATING_DAILY_LOCK_KEY } from '../src/modules/rating/rating-daily.service';
import { RatingService } from '../src/modules/rating/rating.service';
import { bearer, createTestApp, createUser, setLocation, type TestApp } from './support/app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ SOS_EXPAND_DELAY_MS: '3600000' });
});
afterAll(async () => {
  await t.close();
});

type U = { id: string; token: string };
const DAY = 24 * 3600 * 1000;
let areaSeq = 0;

const post = (u: U, path: string, body: object = {}) => request(t.http).post(`/api/v1${path}`).set(bearer(u.token)).send(body);
const get = (u: U, path: string) => request(t.http).get(`/api/v1${path}`).set(bearer(u.token));
const ratingOf = async (id: string) => (await t.prisma.user.findUniqueOrThrow({ where: { id } })).rating;
const review = (u: U, sosId: string, body: object) => post(u, `/sos/${sosId}/reviews`, body);

/**
 * A closed SOS: `arrived` helpers reached the spot; `acceptedOnly` were accepted but never arrived;
 * `withdrawn` offered then withdrew.
 */
async function closedSos(opts: { arrived?: number; acceptedOnly?: number; withdrawn?: number } = {}) {
  const lat = 30 + areaSeq * 0.5;
  const lng = 40 + areaSeq * 0.5;
  areaSeq++;
  const requester = await createUser(t);
  await setLocation(t, requester.id, lat, lng, 0);
  const mk = async () => {
    const u = await createUser(t);
    await setLocation(t, u.id, lat + 0.01, lng, 0);
    return u;
  };
  const sos = (await post(requester, '/sos', { type: 'battery', lat, lng, sharePhone: false }).expect(201)).body as SosDto;
  const arrived: U[] = [];
  const acceptedOnly: U[] = [];
  const withdrawn: U[] = [];
  for (let i = 0; i < (opts.arrived ?? 1); i++) arrived.push(await mk());
  for (let i = 0; i < (opts.acceptedOnly ?? 0); i++) acceptedOnly.push(await mk());
  for (let i = 0; i < (opts.withdrawn ?? 0); i++) withdrawn.push(await mk());
  for (const h of [...arrived, ...acceptedOnly]) {
    const r = (await post(h, `/sos/${sos.id}/respond`).expect(200)).body as SosDto;
    await post(requester, `/sos/${sos.id}/responses/${r.responses[0]!.id}/accept`).expect(200);
  }
  for (const h of withdrawn) {
    await post(h, `/sos/${sos.id}/respond`).expect(200);
    await post(h, `/sos/${sos.id}/withdraw`).expect(200);
  }
  for (const h of arrived) await post(h, `/sos/${sos.id}/arrived`).expect(200);
  return { requester, arrived, acceptedOnly, withdrawn, id: sos.id };
}

const close = (s: { requester: U; id: string }) => post(s.requester, `/sos/${s.id}/close`).expect(200);

describe('trust rating', () => {
  it('changes with a confirmed help and reviews, with exact values and ledger rows', async () => {
    const s = await closedSos();
    const helper = s.arrived[0]!;
    expect(await ratingOf(helper.id)).toBe(50);
    await close(s);
    // help 3 × 0.6 (no review yet) = 1.8; activity 1 day / 4 = 0.25 → 52.05 → 52
    expect(await ratingOf(helper.id)).toBe(52);
    let events = (await get(helper, '/me/rating/events').expect(200)).body.items as RatingEventDto[];
    expect(events).toEqual([{ id: expect.any(String), delta: 2, reason: 'help_confirmed', refId: s.id, createdAt: expect.any(String) }]);

    const r1 = (await review(s.requester, s.id, { targetUserId: helper.id, stars: 5, comment: 'Спасибо!' }).expect(201)).body as ReviewDto;
    // help 3 × 5/5 = 3; reviews (5 + 12) / 4 = 4.25 → +7.5; activity 0.25 → 60.75 → 61
    expect(await ratingOf(helper.id)).toBe(61);
    events = (await get(helper, '/me/rating/events').expect(200)).body.items;
    expect(events[0]).toMatchObject({ delta: 9, reason: 'review_received', refId: r1.id });

    await review(helper, s.id, { targetUserId: s.requester.id, stars: 4 }).expect(201);
    // requester: reviews (4 + 12) / 4 = 4.0 → +5; activity 0.25 → 55.25 → 55
    expect(await ratingOf(s.requester.id)).toBe(55);

    const mine = (await get(helper, '/me/rating').expect(200)).body as RatingDto;
    expect(mine).toEqual({
      rating: 61,
      breakdown: { base: 50, help: 3, reviews: 7.5, activity: 0.25, tenure: 0, votes: 0, penalties: 0 },
      nextThresholds: { sosCreate: 20, sosHelp: 30 },
    });
    // Public breakdown, private ledger.
    const stranger = await createUser(t);
    expect((await get(stranger, `/users/${helper.id}/rating`).expect(200)).body).toEqual(mine);
    await get(stranger, `/users/${newId()}/rating`).expect(404);
    const deleted = await createUser(t, { status: 'deleted' });
    await get(stranger, `/users/${deleted.id}/rating`).expect(404);
    expect(((await get(stranger, '/me/rating/events').expect(200)).body.items as unknown[]).length).toBe(0);
  });

  it('daily recompute with a fake clock: tenure grows, help decays, activity and penalties expire', async () => {
    const s = await closedSos();
    const helper = s.arrived[0]!;
    await close(s);
    await review(s.requester, s.id, { targetUserId: helper.id, stars: 5 }).expect(201);
    expect(await ratingOf(helper.id)).toBe(61);
    const service = t.app.get(RatingService);

    // +180 days: help 3 → 1.5 (half-life), reviews 7.5, activity 0, tenure 6 months → 3 → 62
    const later = new Date(Date.now() + 180 * DAY);
    await service.recomputeAll(later);
    expect(await ratingOf(helper.id)).toBe(62);
    const daily = await t.prisma.ratingEvent.findFirstOrThrow({ where: { userId: helper.id, reason: 'recalc_daily' } });
    expect(daily.delta).toBe(1);

    // Penalties: −10 now; it expires after 365 days.
    await service.applyPenalty(helper.id, 'report_confirmed', null);
    const penalty = await t.prisma.ratingEvent.findFirstOrThrow({ where: { userId: helper.id, reason: 'penalty' } });
    expect(penalty).toMatchObject({ penaltyPoints: -10, penaltyKind: 'report_confirmed' });
    const afterPenalty = await ratingOf(helper.id);
    expect(penalty.delta).toBe(afterPenalty - 62);
    const breakdown = ((await get(helper, '/me/rating').expect(200)).body as RatingDto).breakdown;
    expect(breakdown.penalties).toBe(-10);
    await service.recomputeAll(new Date(Date.now() + 366 * DAY));
    const yearLater = await ratingOf(helper.id);
    // help 3 × 0.5^(366/180) ≈ 0.73, reviews 7.5, tenure 5, no penalty → 63.2 → 63
    expect(yearLater).toBe(63);

    // The daily job runs once per day across instances.
    await t.redis.del(RATING_DAILY_LOCK_KEY);
    expect(await t.app.get(RatingDailyService).runIfDue()).not.toBeNull();
    expect(await t.app.get(RatingDailyService).runIfDue()).toBeNull();
  });

  it('clamps at 0 and records each penalty with its actual delta', async () => {
    const u = await createUser(t);
    const service = t.app.get(RatingService);
    expect(await service.applyPenalty(u.id, 'fake_sos', null)).toBe(0);
    expect(await service.applyPenalty(u.id, 'fake_sos', null)).toBe(0);
    const rows = await t.prisma.ratingEvent.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => [r.reason, r.penaltyPoints, r.delta])).toEqual([
      ['penalty', -50, -50],
      ['penalty', -50, 0],
    ]);
    // A user below 20 can no longer create an SOS (the gate reads the cached rating).
    expect((await post(u, '/sos', { type: 'other', lat: 1, lng: 1, sharePhone: false }).expect(403)).body.error.code).toBe('RATING_TOO_LOW');
  });
});

describe('SOS reviews', () => {
  it('exposes canReview / reviewTargets to each side until written', async () => {
    const s = await closedSos({ arrived: 2, acceptedOnly: 1, withdrawn: 1 });
    const [h1, h2] = s.arrived as [U, U];
    const before = (await get(s.requester, `/sos/${s.id}`).expect(200)).body as SosDto;
    expect(before).toMatchObject({ status: 'in_progress', canReview: false, reviewTargets: [] });
    await close(s);
    const asRequester = (await get(s.requester, `/sos/${s.id}`).expect(200)).body as SosDto;
    expect(asRequester.canReview).toBe(true);
    expect(asRequester.reviewTargets.map((u) => u.id).sort()).toEqual([h1.id, h2.id].sort());
    expect((await get(h1, `/sos/${s.id}`).expect(200)).body.reviewTargets.map((u: { id: string }) => u.id)).toEqual([s.requester.id]);
    for (const u of [s.acceptedOnly[0]!, s.withdrawn[0]!]) {
      expect((await get(u, `/sos/${s.id}`).expect(200)).body).toMatchObject({ canReview: false, reviewTargets: [] });
    }
    await review(s.requester, s.id, { targetUserId: h1.id, stars: 5 }).expect(201);
    expect((await get(s.requester, `/sos/${s.id}`).expect(200)).body.reviewTargets.map((u: { id: string }) => u.id)).toEqual([h2.id]);
    await review(s.requester, s.id, { targetUserId: h2.id, stars: 3 }).expect(201);
    expect((await get(s.requester, `/sos/${s.id}`).expect(200)).body).toMatchObject({ canReview: false, reviewTargets: [] });
  });

  it('enforces every permission branch with its error code', async () => {
    const s = await closedSos({ arrived: 2, acceptedOnly: 1, withdrawn: 1 });
    const [h1, h2] = s.arrived as [U, U];
    const accepted = s.acceptedOnly[0]!;
    const withdrawn = s.withdrawn[0]!;
    const outsider = await createUser(t);
    const ok = (target: U) => ({ targetUserId: target.id, stars: 4 });
    const code = async (res: request.Test, status: number) => (await res.expect(status)).body.error.code as string;

    // Not closed yet (in_progress).
    expect(await code(review(s.requester, s.id, ok(h1)), 403)).toBe('REVIEW_NOT_ALLOWED');
    await close(s);
    expect(await code(review(s.requester, newId(), ok(h1)), 404)).toBe('NOT_FOUND');
    for (const [author, target] of [
      [s.requester, accepted], // never arrived
      [s.requester, withdrawn],
      [s.requester, outsider],
      [s.requester, s.requester], // self
      [h1, h2], // helper → helper
      [h1, h1],
      [accepted, s.requester],
      [withdrawn, s.requester],
      [outsider, s.requester],
      [outsider, h1],
    ] as [U, U][]) {
      expect(await code(review(author, s.id, ok(target)), 403)).toBe('REVIEW_NOT_ALLOWED');
    }
    await review(s.requester, s.id, ok(h1)).expect(201);
    await review(h1, s.id, ok(s.requester)).expect(201);
    expect(await code(review(s.requester, s.id, ok(h1)), 409)).toBe('ALREADY_REVIEWED');
    expect(await code(review(h1, s.id, ok(s.requester)), 409)).toBe('ALREADY_REVIEWED');

    // Window: 14 days after closedAt.
    await t.prisma.sosRequest.update({ where: { id: s.id }, data: { closedAt: new Date(Date.now() - 15 * DAY) } });
    expect(await code(review(s.requester, s.id, ok(h2)), 409)).toBe('REVIEW_WINDOW_CLOSED');
    expect((await get(s.requester, `/sos/${s.id}`).expect(200)).body.canReview).toBe(false);

    // Cancelled SOS: never reviewable.
    const c = await closedSos();
    await post(c.requester, `/sos/${c.id}/cancel`).expect(200);
    expect(await code(review(c.requester, c.id, ok(c.arrived[0]!)), 403)).toBe('REVIEW_NOT_ALLOWED');

    // Validation.
    for (const body of [{ targetUserId: h2.id, stars: 0 }, { targetUserId: h2.id, stars: 6 }, { targetUserId: h2.id, stars: '5' }, { targetUserId: h2.id, stars: 4.5 }, { stars: 5 }, { targetUserId: h2.id, stars: 5, comment: 'x'.repeat(501) }]) {
      expect(await code(review(s.requester, s.id, body), 400)).toBe('VALIDATION_ERROR');
    }
  });

  it('notifies the target and lists reviews on profiles, newest first', async () => {
    const helper = await createUser(t);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const s = await closedSos({ arrived: 0 });
      await setLocation(t, helper.id, 30 + (areaSeq - 1) * 0.5 + 0.01, 40 + (areaSeq - 1) * 0.5, 0);
      const r = (await post(helper, `/sos/${s.id}/respond`).expect(200)).body as SosDto;
      await post(s.requester, `/sos/${s.id}/responses/${r.responses[0]!.id}/accept`).expect(200);
      await post(helper, `/sos/${s.id}/arrived`).expect(200);
      await close(s);
      ids.push(((await review(s.requester, s.id, { targetUserId: helper.id, stars: 3 + i, comment: `отзыв ${i}` }).expect(201)).body as ReviewDto).id);
      const n = await t.prisma.notification.findFirstOrThrow({ where: { userId: helper.id, type: 'review_received' }, orderBy: { createdAt: 'desc' } });
      expect(n.payload).toMatchObject({ reviewId: ids[i], sosId: s.id, stars: 3 + i, author: { id: s.requester.id } });
    }
    const viewer = await createUser(t);
    const p1 = await get(viewer, `/users/${helper.id}/reviews?limit=2`).expect(200);
    const p2 = await get(viewer, `/users/${helper.id}/reviews?limit=2&cursor=${p1.body.nextCursor}`).expect(200);
    const all = [...p1.body.items, ...p2.body.items] as ReviewDto[];
    expect(all.map((r) => r.id)).toEqual([...ids].reverse());
    expect(all[0]).toMatchObject({ stars: 5, comment: 'отзыв 2', refType: 'sos', author: { id: expect.any(String) } });
    await get(viewer, `/users/${newId()}/reviews`).expect(404);
  });
});
