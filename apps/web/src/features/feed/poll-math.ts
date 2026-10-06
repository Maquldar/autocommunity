import type { PollDto } from '@autoc/shared';

export type PollResultRow = { id: string; text: string; voteCount: number; percent: number; mine: boolean; leading: boolean };

/**
 * Percentages for the results bars. Single choice: shares of all votes, rounded with the largest-remainder
 * method so they add up to exactly 100. Multiple choice: share of voters who picked the option (the sum
 * may exceed 100). `leading` marks the option(s) with the most votes (none while nobody voted).
 */
export function pollResults(poll: Pick<PollDto, 'options' | 'multiple' | 'myVotes' | 'totalVoters'>): PollResultRow[] {
  const totalVotes = poll.options.reduce((s, o) => s + o.voteCount, 0);
  const max = Math.max(0, ...poll.options.map((o) => o.voteCount));
  const mine = new Set(poll.myVotes);
  const base = (percent: number, o: PollDto['options'][number]): PollResultRow => ({
    id: o.id,
    text: o.text,
    voteCount: o.voteCount,
    percent,
    mine: mine.has(o.id),
    leading: max > 0 && o.voteCount === max,
  });
  if (poll.multiple) {
    const voters = Math.max(poll.totalVoters, 0);
    return poll.options.map((o) => base(voters ? Math.min(100, Math.round((o.voteCount / voters) * 100)) : 0, o));
  }
  if (!totalVotes) return poll.options.map((o) => base(0, o));
  const exact = poll.options.map((o) => (o.voteCount / totalVotes) * 100);
  const floors = exact.map(Math.floor);
  let rest = 100 - floors.reduce((s, v) => s + v, 0);
  const order = exact.map((v, i) => ({ i, r: v - floors[i]! })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    floors[i]! += 1;
    rest -= 1;
  }
  return poll.options.map((o, i) => base(floors[i]!, o));
}

/** Applies a just-cast vote to a cached poll (optimistic update before the server answers). */
export function applyVote(poll: PollDto, optionIds: string[]): PollDto {
  if (poll.myVotes.length) return poll;
  const picked = new Set(optionIds);
  return {
    ...poll,
    myVotes: [...optionIds],
    totalVoters: poll.totalVoters + 1,
    options: poll.options.map((o) => (picked.has(o.id) ? { ...o, voteCount: o.voteCount + 1 } : o)),
  };
}
