import { RATING_TIER_NAMES, RATING_TIERS, VOTE_REASONS } from '@autoc/shared';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import ru from '../../../messages/ru.json';
import { renderWithIntl } from '../../../test/render';
import { TierLegend } from '@/features/rating/rating-views';
import { VoteTraitsLine } from '@/features/votes/vote-traits';
import { ProfileHeader } from './profile-header';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const user = (rating: number) => ({
  id: 'u1',
  name: 'Даурен',
  nickname: 'dauren',
  avatarUrl: null,
  city: null,
  bio: 'Езжу на работу по Аль-Фараби',
  rating,
  createdAt: '2026-01-10T00:00:00Z',
  status: 'active' as const,
});

describe('tier chip on the profile header', () => {
  it('shows the tier name as a chip, red for 0–29', () => {
    const { rerender } = renderWithIntl(<ProfileHeader user={user(12)} />);
    const chip = screen.getByTestId('tier-badge');
    expect(chip).toHaveTextContent('Repeat offender');
    expect(chip).toHaveAttribute('data-tier', 'warning');
    expect(chip.className).toContain('bg-danger-soft');
    rerender(<ProfileHeader user={user(40)} />);
    expect(screen.getByTestId('tier-badge')).toHaveTextContent('Regular driver');
    rerender(<ProfileHeader user={{ ...user(40), tier: 'gold' }} />);
    expect(screen.getByTestId('tier-badge')).toHaveTextContent('Exemplary driver');
  });

  it('renders the traits footer under the bio', () => {
    renderWithIntl(<ProfileHeader user={user(25)} footer={<VoteTraitsLine traits={{ negative: [{ reason: 'cuts_off', count: 4 }], positive: [] }} />} />);
    const bio = screen.getByText('Езжу на работу по Аль-Фараби');
    const line = screen.getByTestId('vote-traits');
    expect(bio.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line).toHaveTextContent('Often noted: cuts others off');
  });
});

describe('tier legend', () => {
  it('lists every tier as a named chip and marks the current one', () => {
    renderWithIntl(<TierLegend rating={25} />);
    const legend = screen.getByTestId('tier-legend');
    expect(within(legend).getAllByTestId('tier-badge').map((b) => b.textContent)).toEqual([
      'Road legend',
      'Exemplary driver',
      'Respected driver',
      'Reliable driver',
      'Regular driver',
      'Repeat offender',
    ]);
    expect(legend.querySelector('[data-current]')).toHaveAttribute('data-tier', 'warning');
    expect(legend).toHaveTextContent('Repeat offender');
  });
});

describe('messages', () => {
  it('tier names match the shared mapping in both locales', () => {
    for (const tier of RATING_TIERS) {
      expect(ru.tiers.name[tier]).toBe(RATING_TIER_NAMES[tier].ru);
      expect(en.tiers.name[tier]).toBe(RATING_TIER_NAMES[tier].en);
    }
  });
  it('every vote reason has a label, with the client wording in ru', () => {
    for (const r of VOTE_REASONS) {
      expect(ru.votes.reasons[r]).toBeTruthy();
      expect(en.votes.reasons[r]).toBeTruthy();
    }
    expect(ru.votes.reasons).toMatchObject({
      cuts_off: 'Подрезает',
      no_turn_signals: 'Не включает поворотники',
      speeding: 'Превышает скорость',
      tailgating: 'Не держит дистанцию',
      bad_parking: 'Паркуется как попало',
      aggressive: 'Агрессивно водит',
      phone_while_driving: 'Отвлекается на телефон',
      lets_merge: 'Пропускает',
      careful_driver: 'Аккуратно водит',
      signals_properly: 'Всегда включает поворотники',
    });
  });
});
