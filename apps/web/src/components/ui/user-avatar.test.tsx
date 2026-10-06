import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithIntl } from '../../../test/render';
import { PremiumBadge, TierBadge, UserAvatar, UserName } from './user-avatar';

const base = { id: 'u1', name: 'Aidar K.', avatarUrl: null };

describe('UserAvatar', () => {
  it('draws the tier ring and the premium frame, and announces both', () => {
    renderWithIntl(<UserAvatar user={{ ...base, rating: 92, isPremium: true }} size="lg" />);
    const avatar = screen.getByRole('img', { name: 'Aidar K., Premium, Platinum' });
    expect(avatar).toHaveAttribute('data-tier', 'platinum');
    expect(avatar).toHaveAttribute('data-premium', 'true');
    expect(avatar.className).toContain('border-premium');
  });
  it('uses the API tier when present, warns below 30, and stays plain for 30–49', () => {
    const { rerender } = renderWithIntl(<UserAvatar user={{ ...base, rating: 10, tier: 'gold' }} />);
    expect(screen.getByRole('img')).toHaveAttribute('data-tier', 'gold');
    rerender(<UserAvatar user={{ ...base, rating: 12 }} />);
    expect(screen.getByRole('img', { name: 'Aidar K., Low trust' })).toHaveAttribute('data-tier', 'warning');
    rerender(<UserAvatar user={{ ...base, rating: 40 }} />);
    expect(screen.getByRole('img', { name: 'Aidar K.' })).not.toHaveAttribute('data-premium');
  });
  it('decorative avatars are hidden from assistive tech', () => {
    const { container } = renderWithIntl(<UserAvatar user={{ ...base, rating: 70 }} decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('[data-testid="user-avatar"]')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('badges', () => {
  it('tier badge: icon + word, nothing for the plain tier', () => {
    const { rerender, container } = renderWithIntl(<TierBadge tier="silver" />);
    expect(screen.getByTestId('tier-badge')).toHaveTextContent('Silver');
    rerender(<TierBadge tier="warning" />);
    expect(screen.getByTestId('tier-badge')).toHaveTextContent('Low trust');
    rerender(<TierBadge tier="none" />);
    expect(container).toBeEmptyDOMElement();
  });
  it('premium badge and name', () => {
    renderWithIntl(
      <>
        <PremiumBadge />
        <UserName user={{ ...base, isPremium: true }} />
      </>,
    );
    expect(screen.getAllByTestId('premium-badge')[0]).toHaveTextContent('Premium');
    expect(screen.getByText('Aidar K.')).toBeInTheDocument();
    expect(screen.getAllByTestId('premium-badge')).toHaveLength(2);
  });
});
