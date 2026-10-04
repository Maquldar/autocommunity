import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { clampRating, getTrustLevel, TRUST_THRESHOLDS } from '@/lib/rating';
import { renderWithIntl } from '../../../test/render';
import { RatingBadge } from './rating-badge';

describe('trust levels', () => {
  it('uses 30 (SOS helper minimum) and 70 as thresholds', () => {
    expect(TRUST_THRESHOLDS).toEqual({ medium: 30, high: 70 });
  });

  it.each([
    [0, 'low'],
    [29, 'low'],
    [29.4, 'low'],
    [29.5, 'medium'],
    [30, 'medium'],
    [50, 'medium'],
    [69, 'medium'],
    [70, 'high'],
    [100, 'high'],
    [-10, 'low'],
    [140, 'high'],
    [Number.NaN, 'low'],
  ] as const)('rating %s → %s', (rating, level) => {
    expect(getTrustLevel(rating)).toBe(level);
  });

  it('clamps and rounds to 0..100', () => {
    expect(clampRating(-5)).toBe(0);
    expect(clampRating(101)).toBe(100);
    expect(clampRating(72.6)).toBe(73);
  });
});

describe('<RatingBadge>', () => {
  it('shows the number and announces value and level', () => {
    const { container } = renderWithIntl(<RatingBadge rating={72} />);
    const badge = container.firstElementChild;
    expect(badge).toHaveAttribute('data-level', 'high');
    expect(screen.getByText('Trust rating 72 out of 100, High')).toHaveClass('sr-only');
    expect(screen.getByText('72')).toHaveAttribute('aria-hidden', 'true');
  });

  it.each([
    [12, 'low', 'Low'],
    [45, 'medium', 'Medium'],
    [99, 'high', 'High'],
  ])('rating %i renders the %s style and label', (rating, level, label) => {
    const { container } = renderWithIntl(<RatingBadge rating={rating} showLabel />);
    expect(container.firstElementChild).toHaveAttribute('data-level', level);
    expect(container.firstElementChild?.className).toContain(`bg-trust-${level}-soft`);
    expect(screen.getByText(`· ${label}`)).toBeInTheDocument();
  });

  it('clamps out-of-range input before display', () => {
    renderWithIntl(<RatingBadge rating={180} />);
    expect(screen.getByText('Trust rating 100 out of 100, High')).toBeInTheDocument();
  });
});
