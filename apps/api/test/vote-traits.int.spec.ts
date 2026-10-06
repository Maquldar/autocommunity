import type { VoteReason, VoteSummaryDto, VoteValue } from '@autoc/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../src/common/ids';
import { bearer, createTestApp, type TestApp } from './support/app';
import { seasoned, type U } from './support/phase9';

/* Phase 10 — vote reasons for driving behaviour and the "what people say" traits (API.md §10.2–10.3). */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const DAY_MS = 24 * 3600 * 1000;
const summary = async (viewer: U, targetId: string) => (await request(t.http).get(`/api/v1/users/${targetId}/votes/summary`).set(bearer(viewer.token)).expect(200)).body as VoteSummaryDto;
const vote = (u: U, target: string, body: object) => request(t.http).post(`/api/v1/users/${target}/votes`).set(bearer(u.token)).send(body);

/** Inserts votes directly (bypassing the cooldown and daily limit) from fresh voters, `daysAgo` old. */
async function votes(targetId: string, list: [VoteValue, VoteReason, number?][], voterIds?: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const [i, [value, reason, daysAgo = 1]] of list.entries()) {
    const voterId = voterIds?.[i] ?? (await seasoned(t)).id;
    ids.push(voterId);
    await t.prisma.userVote.create({ data: { id: newId(), voterId, targetId, value, reason, weight: 1, createdAt: new Date(Date.now() - daysAgo * DAY_MS) } });
  }
  return ids;
}

describe('new vote reasons', () => {
  it('accepts the driving reasons with their sign and rejects the wrong sign', async () => {
    const target = await seasoned(t);
    expect((await vote(await seasoned(t), target.id, { value: -1, reason: 'cuts_off' }).expect(201)).body).toMatchObject({ value: -1, reason: 'cuts_off' });
    expect((await vote(await seasoned(t), target.id, { value: 1, reason: 'lets_merge' }).expect(201)).body).toMatchObject({ value: 1, reason: 'lets_merge' });
    for (const body of [
      { value: 1, reason: 'no_turn_signals' },
      { value: 1, reason: 'phone_while_driving' },
      { value: -1, reason: 'signals_properly' },
      { value: -1, reason: 'careful_driver' },
    ]) {
      expect((await vote(await seasoned(t), target.id, body).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    }
    const s = await summary(target, target.id);
    expect(s.byReason).toMatchObject({ cuts_off: 1, lets_merge: 1, speeding: 0, tailgating: 0, bad_parking: 0, aggressive: 0, careful_driver: 0, signals_properly: 0 });
  });

  it('the database enforces the enum and the sign', async () => {
    const target = await seasoned(t);
    const voter = await seasoned(t);
    await expect(t.prisma.$executeRaw`INSERT INTO user_votes (id, voter_id, target_id, value, reason, weight) VALUES (${newId()}::uuid, ${voter.id}::uuid, ${target.id}::uuid, 1, 'cuts_off', 1)`).rejects.toThrow(/user_votes_reason_sign_check/);
    await expect(t.prisma.$executeRaw`INSERT INTO user_votes (id, voter_id, target_id, value, reason, weight) VALUES (${newId()}::uuid, ${voter.id}::uuid, ${target.id}::uuid, -1, 'nonsense', 1)`).rejects.toThrow(/VoteReason/);
    await t.prisma.$executeRaw`INSERT INTO user_votes (id, voter_id, target_id, value, reason, weight) VALUES (${newId()}::uuid, ${voter.id}::uuid, ${target.id}::uuid, -1, 'other', 1)`;
  });
});

describe('votes summary traits', () => {
  it('nothing below 3 voters, even when they all say the same', async () => {
    const target = await seasoned(t);
    await votes(target.id, [
      [-1, 'cuts_off'],
      [-1, 'cuts_off'],
    ]);
    expect((await summary(await seasoned(t), target.id)).traits).toEqual({ negative: [], positive: [] });
    await votes(target.id, [[1, 'polite']]);
    expect((await summary(await seasoned(t), target.id)).traits).toEqual({ negative: [{ reason: 'cuts_off', count: 2 }], positive: [] });
  });

  it('a reason needs ≥ 2 voters and ≥ 25% of its sign; `other` is never a trait; sorted by count', async () => {
    const target = await seasoned(t);
    await votes(target.id, [
      [-1, 'no_turn_signals'],
      [-1, 'no_turn_signals'],
      [-1, 'cuts_off'],
      [-1, 'cuts_off'],
      [-1, 'cuts_off'],
      [-1, 'cuts_off'],
      [-1, 'speeding'], // 1 voter → out
      [-1, 'other'],
      [1, 'lets_merge'],
      [1, 'lets_merge'],
      [1, 'polite'], // 1 voter → out
    ]);
    const s = await summary(await seasoned(t), target.id);
    expect(s.traits).toEqual({
      negative: [
        { reason: 'cuts_off', count: 4 },
        { reason: 'no_turn_signals', count: 2 }, // exactly 25% of 8
      ],
      positive: [{ reason: 'lets_merge', count: 2 }],
    });

    // 2 of 9 negative voters (22%) is below the share
    await votes(target.id, [[-1, 'speeding']]);
    const after = await summary(await seasoned(t), target.id);
    expect(after.traits.negative.map((x) => x.reason)).toEqual(['cuts_off']);
  });

  it('at most 3 per sign', async () => {
    const target = await seasoned(t);
    await votes(target.id, [
      [-1, 'cuts_off'],
      [-1, 'cuts_off'],
      [-1, 'cuts_off'],
      [-1, 'tailgating'],
      [-1, 'tailgating'],
      [-1, 'speeding'],
      [-1, 'speeding'],
      [-1, 'aggressive'],
      [-1, 'aggressive'],
    ]);
    // every reason has ≥ 2 voters, but 2 of 9 (22%) is below the share: only cuts_off (3 of 9) stays
    const s = await summary(await seasoned(t), target.id);
    expect(s.traits.negative).toEqual([{ reason: 'cuts_off', count: 3 }]);

    const other = await seasoned(t);
    await votes(other.id, [
      [1, 'lets_merge'],
      [1, 'lets_merge'],
      [1, 'careful_driver'],
      [1, 'careful_driver'],
      [1, 'signals_properly'],
      [1, 'signals_properly'],
      [1, 'polite'],
      [1, 'polite'],
    ]);
    const p = await summary(await seasoned(t), other.id);
    expect(p.traits.positive).toEqual([
      { reason: 'polite', count: 2 },
      { reason: 'lets_merge', count: 2 },
      { reason: 'careful_driver', count: 2 },
    ]);
  });

  it('only the last 180 days count, and a repeat voter counts once', async () => {
    const target = await seasoned(t);
    await votes(target.id, [
      [-1, 'cuts_off', 200],
      [-1, 'cuts_off', 190],
      [-1, 'cuts_off', 181],
      [1, 'careful_driver', 3],
    ]);
    expect((await summary(await seasoned(t), target.id)).traits).toEqual({ negative: [], positive: [] });

    // one hater voting every 30 days is one voter
    const hater = (await seasoned(t)).id;
    await votes(
      target.id,
      [
        [-1, 'phone_while_driving', 100],
        [-1, 'phone_while_driving', 65],
        [-1, 'phone_while_driving', 30],
        [-1, 'phone_while_driving', 1],
      ],
      [hater, hater, hater, hater],
    );
    await votes(target.id, [[-1, 'bad_parking']]);
    const s = await summary(await seasoned(t), target.id);
    expect(s.down).toBe(8); // all-time counts are votes…
    expect(s.traits).toEqual({ negative: [], positive: [] }); // …traits count different voters (3 in the window, none twice)
  });

  it('is public to signed-in users and anonymous', async () => {
    const target = await seasoned(t);
    const voterIds = await votes(target.id, [
      [-1, 'cuts_off'],
      [-1, 'cuts_off'],
      [-1, 'no_turn_signals'],
      [-1, 'no_turn_signals'],
    ]);
    const viewers = [await seasoned(t), target, await seasoned(t, { rating: 10 })];
    for (const viewer of viewers) {
      const s = await summary(viewer, target.id);
      expect(s.traits.negative.map((x) => x.reason)).toEqual(['cuts_off', 'no_turn_signals']);
      for (const trait of [...s.traits.negative, ...s.traits.positive]) expect(Object.keys(trait).sort()).toEqual(['count', 'reason']);
      const json = JSON.stringify(s);
      for (const id of voterIds) expect(json).not.toContain(id);
    }
    await request(t.http).get(`/api/v1/users/${target.id}/votes/summary`).expect(401);
  });
});
