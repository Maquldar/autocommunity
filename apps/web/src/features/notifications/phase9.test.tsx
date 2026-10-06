import type { NotificationDto } from '@autoc/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createAppRealtimeHandlers } from '@/lib/realtime/handlers';
import { renderWithIntl } from '../../../test/render';
import { describeNotification } from './describe';
import { NotificationItem } from './notification-item';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const sender = { id: 'u1', nickname: 'aidar', name: 'Aidar K.', avatarUrl: null, rating: 85, isPremium: true };
const vehicleId = '0b9d3f5e-1c2a-4f6b-9a7c-123456789abc';
const n = (type: NotificationDto['type'], payload: Record<string, unknown>): NotificationDto => ({
  id: `n-${type}`,
  type,
  payload,
  readAt: null,
  createdAt: new Date(Date.now() - 60_000).toISOString(),
});
function render(ui: ReactElement) {
  return renderWithIntl(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

describe('phase 9 notifications', () => {
  it('describes every new type with the API.md hrefs', () => {
    expect(describeNotification(n('wallet_received', { transactionId: 't', amount: 500, message: 'спасибо', user: sender }))).toMatchObject({
      kind: 'wallet_received',
      amount: 500,
      message: 'спасибо',
      href: '/wallet',
    });
    expect(describeNotification(n('wallet_admin', { action: 'freeze', amount: null, balance: 10, note: 'check' }))).toMatchObject({ action: 'freeze', href: '/wallet' });
    expect(describeNotification(n('premium_reminder', { periodEnd: '2026-11-01T00:00:00Z', autoRenew: true, lowBalance: true, priceCoins: 1490, balance: 100 })).href).toBe('/wallet');
    expect(describeNotification(n('premium_reminder', { periodEnd: '2026-11-01T00:00:00Z', autoRenew: false, lowBalance: false, priceCoins: 1490, balance: 100 })).href).toBe('/premium');
    expect(describeNotification(n('premium_renewed', { periodEnd: '2026-11-01T00:00:00Z', priceCoins: 1490, balance: 0 })).href).toBe('/premium');
    expect(describeNotification(n('premium_expired', { reason: 'wallet_frozen' }))).toMatchObject({ reason: 'wallet_frozen', href: '/premium' });
    expect(describeNotification(n('vote_received', { voteId: 'v', value: -1, reason: 'rude' }))).toMatchObject({ reason: 'rude', href: '/profile?tab=votes' });
    expect(describeNotification(n('violation_reported', { violationId: 'x', vehicleId, category: 'speeding', vehicle: 'Toyota Camry' })).href).toBe(`/vehicles/${vehicleId}?tab=violations`);
    expect(describeNotification(n('violation_status', { violationId: 'x', vehicleId, category: 'speeding', status: 'approved', role: 'owner' })).href).toBe(`/vehicles/${vehicleId}?tab=violations`);
    expect(describeNotification(n('violation_status', { violationId: 'x', vehicleId, category: 'speeding', status: 'rejected', role: 'submitter' })).href).toBe('/settings/violations');
  });

  it('is defensive about payloads (bad ids, unknown values, pre-phase 9 users)', () => {
    expect(describeNotification(n('violation_reported', { vehicleId: '../x', category: 'nope' }))).toMatchObject({ category: null, href: null });
    expect(describeNotification(n('premium_expired', {}))).toMatchObject({ reason: 'other' });
    const legacy = describeNotification(n('wallet_received', { amount: 5, user: { id: 'u2', nickname: 'x', name: 'X', avatarUrl: null, rating: 50 } }));
    expect(legacy.kind === 'wallet_received' && legacy.user?.isPremium).toBe(false);
  });

  it.each([
    ['wallet_received', { transactionId: 't', amount: 500, message: 'за помощь', user: sender }, /Aidar K\. sent you 500 coins/, '/wallet'],
    ['wallet_admin', { action: 'adjust', amount: -200, balance: 300, note: 'refund' }, /A moderator took away 200 coins\. Balance: 300/, '/wallet'],
    ['wallet_admin', { action: 'freeze', amount: null, balance: 300, note: 'check' }, /Your wallet was frozen by a moderator/, '/wallet'],
    ['premium_reminder', { periodEnd: '2026-11-01T00:00:00Z', autoRenew: true, lowBalance: false, priceCoins: 1490, balance: 3000 }, /Premium renews on .*1,490 coins will be charged/, '/premium'],
    ['premium_renewed', { periodEnd: '2026-11-01T00:00:00Z', priceCoins: 1490, balance: 10 }, /Premium renewed until/, '/premium'],
    ['premium_expired', { reason: 'insufficient_funds' }, /Premium ended: not enough coins to renew/, '/premium'],
    ['vote_received', { voteId: 'v', value: -1, reason: 'dangerous_driving' }, /thumbs down: Dangerous driving/, '/profile?tab=votes'],
    ['violation_reported', { violationId: 'x', vehicleId, category: 'red_light', vehicle: 'Toyota Camry' }, /Violation reported on your Toyota Camry\s*: Running a red light/, `/vehicles/${vehicleId}?tab=violations`],
    ['violation_status', { violationId: 'x', vehicleId, category: 'speeding', status: 'approved', role: 'submitter' }, /Your report was confirmed: Speeding/, `/vehicles/${vehicleId}?tab=violations`],
  ] as const)('renders %s', (type, payload, name, href) => {
    render(<NotificationItem notification={n(type, payload)} onRead={vi.fn()} />);
    expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
  });

  it('shows the transfer message under the title', () => {
    render(<NotificationItem notification={n('wallet_received', { amount: 1, message: 'за помощь', user: sender })} onRead={vi.fn()} />);
    expect(screen.getByTestId('notification-note')).toHaveTextContent('за помощь');
  });

  it('live wallet / vote / violation notifications refresh their queries', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const handlers = createAppRealtimeHandlers({ queryClient, toast: vi.fn(), logout: vi.fn() });
    const keys = () => invalidate.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    handlers.onNotification(n('wallet_received', { amount: 1, user: sender }));
    expect(keys()).toEqual(expect.arrayContaining(['["wallet"]', '["me"]']));
    invalidate.mockClear();
    handlers.onNotification(n('vote_received', { reason: 'rude' }));
    expect(keys()).toEqual(expect.arrayContaining(['["votes"]', '["rating"]']));
    invalidate.mockClear();
    handlers.onNotification(n('violation_status', { vehicleId, status: 'approved', role: 'owner' }));
    expect(keys()).toEqual(expect.arrayContaining(['["violations"]', '["vehicles"]']));
  });
});
