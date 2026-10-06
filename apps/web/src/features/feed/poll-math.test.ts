import type { PollDto } from '@autoc/shared';
import { describe, expect, it } from 'vitest';
import { applyVote, pollResults } from './poll-math';

const poll = (counts: number[], over: Partial<PollDto> = {}): PollDto => ({
  question: 'Q',
  multiple: false,
  options: counts.map((voteCount, i) => ({ id: `o${i}`, text: `Option ${i}`, voteCount })),
  myVotes: [],
  totalVoters: counts.reduce((s, c) => s + c, 0),
  ...over,
});

describe('pollResults', () => {
  it('single choice: largest remainder rounding sums to 100', () => {
    const rows = pollResults(poll([1, 1, 1]));
    expect(rows.map((r) => r.percent)).toEqual([34, 33, 33]);
    expect(pollResults(poll([6, 4, 2, 1])).map((r) => r.percent)).toEqual([46, 31, 15, 8]);
    for (const counts of [[2, 3, 7], [1, 0, 0, 0, 0, 2], [13, 17, 19]]) {
      expect(pollResults(poll(counts)).reduce((s, r) => s + r.percent, 0)).toBe(100);
    }
  });

  it('no votes: zeros and no leader', () => {
    const rows = pollResults(poll([0, 0]));
    expect(rows.map((r) => [r.percent, r.leading])).toEqual([
      [0, false],
      [0, false],
    ]);
  });

  it('multiple choice: share of voters per option', () => {
    const rows = pollResults(poll([5, 2, 4], { multiple: true, totalVoters: 6, myVotes: ['o0', 'o2'] }));
    expect(rows.map((r) => r.percent)).toEqual([83, 33, 67]);
    expect(rows.map((r) => r.mine)).toEqual([true, false, true]);
    expect(rows.map((r) => r.leading)).toEqual([true, false, false]);
  });

  it('marks ties as leading', () => {
    expect(pollResults(poll([3, 3, 1])).map((r) => r.leading)).toEqual([true, true, false]);
  });
});

describe('applyVote', () => {
  it('adds the vote once', () => {
    const voted = applyVote(poll([1, 0]), ['o1']);
    expect(voted.myVotes).toEqual(['o1']);
    expect(voted.totalVoters).toBe(2);
    expect(voted.options.map((o) => o.voteCount)).toEqual([1, 1]);
    expect(applyVote(voted, ['o0'])).toBe(voted);
  });
});
