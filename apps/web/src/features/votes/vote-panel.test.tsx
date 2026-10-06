import { VOTE_REASONS, type VoteReason, type VoteSummaryDto } from '@autoc/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '../../../test/render';
import { voteKeys } from './api';
import { VotePanel } from './vote-panel';

// Radix radios measure themselves; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const summary = (over: Partial<VoteSummaryDto> = {}): VoteSummaryDto => ({
  userId: 'u2',
  up: 3,
  down: 1,
  byReason: { ...(Object.fromEntries(VOTE_REASONS.map((r) => [r, 0])) as Record<VoteReason, number>), helped_on_road: 2, polite: 1, rude: 1 },
  myVote: null,
  eligibility: 'ok',
  traits: { negative: [], positive: [] },
  ...over,
});

function renderPanel(data: VoteSummaryDto) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(voteKeys.summary('u2'), data);
  return renderWithIntl(
    <QueryClientProvider client={client}>
      <VotePanel userId="u2" name="Dana" />
    </QueryClientProvider>,
  );
}

describe('VotePanel', () => {
  it('shows counts, reason chips and the vote buttons', () => {
    renderPanel(summary());
    expect(screen.getByTestId('votes-up')).toHaveTextContent('3 up');
    expect(screen.getByTestId('votes-down')).toHaveTextContent('1 down');
    expect(screen.getByRole('list', { name: 'Reasons' })).toHaveTextContent('Helped on the road2');
    expect(screen.getByTestId('vote-up')).toBeEnabled();
  });

  it('offers only negative reasons (and Other) for a thumbs down', () => {
    renderPanel(summary());
    fireEvent.click(screen.getByTestId('vote-down'));
    const dialog = screen.getByTestId('vote-dialog');
    const radios = within(dialog).getAllByRole('radio').map((r) => r.getAttribute('value'));
    expect(radios).toEqual(['rude', 'dangerous_driving', 'scam', 'cuts_off', 'no_turn_signals', 'speeding', 'tailgating', 'bad_parking', 'aggressive', 'phone_while_driving', 'other']);
    expect(within(dialog).getByLabelText("Doesn't use turn signals")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vote' }));
    expect(within(dialog).getByText('Choose a reason.')).toBeInTheDocument();
  });

  it('after voting: "vote again in N days"', () => {
    renderPanel(summary({ eligibility: 'already_voted', myVote: { id: 'v', value: 1, reason: 'polite', comment: null, createdAt: new Date().toISOString(), canVoteAgainAt: new Date(Date.now() + 29.5 * 86_400_000).toISOString() } }));
    expect(screen.getByTestId('my-vote')).toHaveTextContent('You voted thumbs up: Polite');
    expect(screen.getByTestId('vote-again')).toHaveTextContent('You can vote again in 30 days');
    expect(screen.queryByTestId('vote-up')).toBeNull();
  });

  it('explains ineligibility instead of the buttons', () => {
    renderPanel(summary({ eligibility: 'rating_too_low' }));
    expect(screen.getByTestId('vote-eligibility')).toHaveTextContent('You need a trust rating of at least 40 to vote.');
    expect(screen.queryByTestId('vote-down')).toBeNull();
  });
});

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
