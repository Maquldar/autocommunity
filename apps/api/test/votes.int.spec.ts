import type { AdminVoteDto, MyVoteDto, Paginated, RatingDto, VoteSummaryDto } from '@autoc/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../src/common/ids';
import { BackgroundTasks } from '../src/infra/tasks/background-tasks';
import { bearer, createTestApp, createUser, type TestApp } from './support/app';
import { admin, seasoned, type U } from './support/phase9';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const drain = () => t.app.get(BackgroundTasks).drain();
const get = (u: U, path: string) => request(t.http).get(`/api/v1${path}`).set(bearer(u.token));
const vote = (u: U, target: string, body: object) => request(t.http).post(`/api/v1/users/${target}/votes`).set(bearer(u.token)).send(body);
const up = { value: 1, reason: 'helped_on_road' };
const down = { value: -1, reason: 'rude' };

/** The rating ledger must explain users.rating (50 + Σ delta). */
async function ledgerMatches(userId: string): Promise<boolean> {
  const [r] = await t.prisma.$queryRaw<{ sum: number }[]>`SELECT coalesce(sum(delta), 0)::int AS sum FROM rating_events WHERE user_id = ${userId}::uuid`;
  const u = await t.prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return 50 + r!.sum === u.rating;
}

describe('POST /users/:id/votes', () => {
  it('validates the body and the reason/value pairing', async () => {
    const voter = await seasoned(t);
    const target = await seasoned(t, { rating: 50 });
    for (const body of [{ value: 2, reason: 'polite' }, { value: 1, reason: 'scam' }, { value: -1, reason: 'polite' }, { value: 1, reason: 'nice' }, { ...up, comment: 'x'.repeat(201) }]) {
      expect((await vote(voter, target.id, body).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('records the vote with the voter weight and moves the rating through the ledger', async () => {
    const voter = await seasoned(t, { rating: 85 });
    const target = await seasoned(t, { rating: 50 });
    const res = (await vote(voter, target.id, { ...up, comment: '  Помог с аккумулятором  ' }).expect(201)).body as MyVoteDto;
    expect(res).toMatchObject({ value: 1, reason: 'helped_on_road', comment: 'Помог с аккумулятором' });
    expect(new Date(res.canVoteAgainAt).getTime() - new Date(res.createdAt).getTime()).toBe(30 * 24 * 3600 * 1000);
    expect((await t.prisma.userVote.findUniqueOrThrow({ where: { id: res.id } })).weight).toBe(1.5);

    const rating = (await get(target, '/me/rating').expect(200)).body as RatingDto;
    expect(rating.breakdown.votes).toBe(1.5);
    const ev = await t.prisma.ratingEvent.findFirst({ where: { userId: target.id, reason: 'vote_received', refId: res.id } });
    expect(ev).not.toBeNull();
    expect(await ledgerMatches(target.id)).toBe(true);
    // upvotes notify no one
    expect(await t.prisma.notification.count({ where: { userId: target.id, type: 'vote_received' } })).toBe(0);
  });

  it('downvotes notify the target without naming the voter', async () => {
    const voter = await seasoned(t, { name: 'Секретный Голос' });
    const target = await seasoned(t);
    const res = (await vote(voter, target.id, { value: -1, reason: 'dangerous_driving' }).expect(201)).body as MyVoteDto;
    const n = await t.prisma.notification.findFirstOrThrow({ where: { userId: target.id, type: 'vote_received' } });
    expect(n.payload).toEqual({ voteId: res.id, value: -1, reason: 'dangerous_driving' });
    expect(JSON.stringify(n.payload)).not.toContain(voter.id);
    expect(((await get(target, '/me/rating')).body as RatingDto).breakdown.votes).toBe(-1);
  });

  it('enforces voter and target gates', async () => {
    const voter = await seasoned(t);
    const target = await seasoned(t);
    expect((await vote(voter, voter.id, up).expect(400)).body.error.code).toBe('INVALID_TARGET');
    await vote(voter, newId(), up).expect(404);
    await vote(voter, (await createUser(t, { status: 'deleted' })).id, up).expect(404);
    await vote(voter, (await createUser(t, { onboarded: false })).id, up).expect(404);
    const young = await seasoned(t, { ageDays: 6 });
    const tooNew = (await vote(young, target.id, up).expect(403)).body.error;
    expect(tooNew).toMatchObject({ code: 'ACCOUNT_TOO_NEW', details: { minDays: 7 } });
    expect(tooNew.details.retryAfterSec).toBeGreaterThan(0);
    expect((await vote(await seasoned(t, { rating: 39 }), target.id, up).expect(403)).body.error).toMatchObject({ code: 'RATING_TOO_LOW', details: { min: 40 } });
    const blocked = await seasoned(t, { status: 'blocked' });
    expect((await vote(blocked, target.id, up).expect(403)).body.error.code).toBe('ACCOUNT_BLOCKED');
    // blocked targets can be voted on
    await vote(voter, (await seasoned(t, { status: 'blocked' })).id, down).expect(201);
  });

  it('one vote per pair per 30 days (409), then allowed again', async () => {
    const voter = await seasoned(t);
    const target = await seasoned(t);
    const first = (await vote(voter, target.id, up).expect(201)).body as MyVoteDto;
    const again = (await vote(voter, target.id, down).expect(409)).body.error;
    expect(again.code).toBe('ALREADY_VOTED');
    expect(again.details.canVoteAgainAt).toBe(first.canVoteAgainAt);
    await t.prisma.userVote.update({ where: { id: first.id }, data: { createdAt: new Date(Date.now() - 31 * 24 * 3600 * 1000) } });
    await vote(voter, target.id, down).expect(201);
  });

  it('concurrent votes on the same pair produce exactly one', async () => {
    const voter = await seasoned(t);
    const target = await seasoned(t, { rating: 50 });
    const res = await Promise.all(Array.from({ length: 6 }, () => vote(voter, target.id, up)));
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    expect(res.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await t.prisma.userVote.count({ where: { voterId: voter.id, targetId: target.id } })).toBe(1);
    expect(await ledgerMatches(target.id)).toBe(true);
  });

  it('concurrent votes from different voters on one target all succeed (no deadlock) with a consistent rating', async () => {
    const target = await seasoned(t, { rating: 50 });
    const voters = await Promise.all(Array.from({ length: 10 }, (_, i) => seasoned(t, { rating: i % 2 ? 85 : 65 })));
    const res = await Promise.all(voters.map((v, i) => vote(v, target.id, i % 3 ? up : down)));
    expect(res.map((r) => r.status)).toEqual(Array(10).fill(201));
    expect(await t.prisma.userVote.count({ where: { targetId: target.id } })).toBe(10);
    expect(await ledgerMatches(target.id)).toBe(true);
    const r = (await get(target, '/me/rating')).body as RatingDto;
    expect((await t.prisma.user.findUniqueOrThrow({ where: { id: target.id } })).rating).toBe(r.rating);
  });

  it('20 votes per day per voter', async () => {
    const voter = await seasoned(t);
    const targets = await Promise.all(Array.from({ length: 21 }, () => seasoned(t)));
    for (let i = 0; i < 20; i++) await vote(voter, targets[i]!.id, up).expect(201);
    expect((await vote(voter, targets[20]!.id, up).expect(429)).body.error.code).toBe('RATE_LIMITED');
    expect(((await get(voter, `/users/${targets[20]!.id}/votes/summary`)).body as VoteSummaryDto).eligibility).toBe('daily_limit');
  });

  it('the votes component is capped at ±15', async () => {
    const target = await seasoned(t, { rating: 50 });
    const voters = await Promise.all(Array.from({ length: 12 }, () => seasoned(t, { rating: 90 })));
    for (const v of voters) await vote(v, target.id, up).expect(201);
    const r = (await get(target, '/me/rating')).body as RatingDto;
    expect(r.breakdown.votes).toBe(15);
    expect(await ledgerMatches(target.id)).toBe(true);
  });
});

describe('GET /users/:id/votes/summary', () => {
  it('counts per reason, shows my vote and eligibility, never voter identities', async () => {
    const target = await seasoned(t);
    const a = await seasoned(t);
    const b = await seasoned(t);
    const c = await seasoned(t);
    await vote(a, target.id, up).expect(201);
    await vote(b, target.id, { value: 1, reason: 'polite' }).expect(201);
    await vote(c, target.id, { value: -1, reason: 'other' }).expect(201);
    const s = (await get(a, `/users/${target.id}/votes/summary`).expect(200)).body as VoteSummaryDto;
    expect(s).toMatchObject({ userId: target.id, up: 2, down: 1, eligibility: 'already_voted', myVote: { value: 1, reason: 'helped_on_road' } });
    expect(s.byReason).toEqual({ helped_on_road: 1, polite: 1, good_driver: 0, rude: 0, dangerous_driving: 0, scam: 0, other: 1 });
    for (const v of [a, b, c]) expect(JSON.stringify(s).replace(s.myVote!.id, '')).not.toContain(v.id);

    const fresh = await seasoned(t);
    expect(((await get(fresh, `/users/${target.id}/votes/summary`)).body as VoteSummaryDto)).toMatchObject({ myVote: null, eligibility: 'ok' });
    expect(((await get(target, `/users/${target.id}/votes/summary`)).body as VoteSummaryDto).eligibility).toBe('self');
    expect(((await get(await seasoned(t, { ageDays: 1 }), `/users/${target.id}/votes/summary`)).body as VoteSummaryDto).eligibility).toBe('account_too_new');
    expect(((await get(await seasoned(t, { rating: 10 }), `/users/${target.id}/votes/summary`)).body as VoteSummaryDto).eligibility).toBe('rating_too_low');
    await get(fresh, `/users/${(await createUser(t, { status: 'deleted' })).id}/votes/summary`).expect(404);
  });
});

describe('vote_burst', () => {
  it('5 downvotes in 24 h from new or low accounts → one flag; trusted voters do not count', async () => {
    const target = await seasoned(t);
    for (let i = 0; i < 6; i++) {
      const v = await seasoned(t, { ageDays: 10, rating: i % 2 ? 45 : 70 }); // all < 30 days old
      await vote(v, target.id, down).expect(201);
      await drain();
    }
    const flags = await t.prisma.fraudFlag.findMany({ where: { userId: target.id, kind: 'vote_burst' } });
    expect(flags).toHaveLength(1);
    expect((flags[0]!.details as { count: number }).count).toBe(5);

    const other = await seasoned(t);
    for (let i = 0; i < 5; i++) await vote(await seasoned(t, { ageDays: 90, rating: 70 }), other.id, down).expect(201);
    await drain();
    expect(await t.prisma.fraudFlag.count({ where: { userId: other.id, kind: 'vote_burst' } })).toBe(0);
  });
});

describe('admin votes', () => {
  it('lists votes with voters and removes one with an audited note, recomputing the rating', async () => {
    const adm = await admin(t);
    const target = await seasoned(t, { rating: 50 });
    const voter = await seasoned(t, { rating: 70 });
    const v = (await vote(voter, target.id, down).expect(201)).body as MyVoteDto;
    await get(voter, `/admin/users/${target.id}/votes`).expect(403);
    const list = (await get(adm, `/admin/users/${target.id}/votes?value=-1`).expect(200)).body as Paginated<AdminVoteDto>;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ id: v.id, voter: { id: voter.id }, target: { id: target.id }, value: -1, reason: 'rude', weight: 1 });
    expect(((await get(adm, `/admin/users/${target.id}/votes?value=1`)).body as Paginated<AdminVoteDto>).items).toHaveLength(0);

    const del = (body: object) => request(t.http).delete(`/api/v1/admin/votes/${v.id}`).set(bearer(adm.token)).send(body);
    await del({}).expect(400);
    await del({ note: 'Накрутка' }).expect(204);
    await del({ note: 'Накрутка' }).expect(404);
    expect(((await get(target, '/me/rating')).body as RatingDto).breakdown.votes).toBe(0);
    expect(await ledgerMatches(target.id)).toBe(true);
    expect(await t.prisma.adminAction.findFirst({ where: { action: 'vote.remove', targetId: v.id, targetUserId: target.id, note: 'Накрутка' } })).not.toBeNull();
  });
});
