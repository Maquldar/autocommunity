import type { NotificationDto } from '@autoc/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '../../../test/render';
import { describeNotification } from './describe';
import { NotificationItem } from './notification-item';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const user = { id: 'u1', nickname: 'aidar', name: 'Aidar K.', avatarUrl: null, rating: 72 };
const base = { readAt: null, createdAt: new Date(Date.now() - 60_000).toISOString() };
const event = { eventId: 'e1', communityId: 'c1', communityName: 'Toyota Club KZ', title: 'Sunday meetup', startsAt: '2026-10-11T06:00:00.000Z', place: 'Dostyk Plaza' };

function render(ui: ReactElement) {
  return renderWithIntl(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}
const n = (type: NotificationDto['type'], payload: Record<string, unknown>): NotificationDto => ({ id: `n-${type}`, type, payload, ...base });

describe('phase 8 notifications', () => {
  it('describes events and posts with safe links', () => {
    expect(describeNotification(n('event_new', event)).href).toBe('/events/e1');
    expect(describeNotification(n('event_new', { ...event, change: 'cancelled' })).href).toBe('/communities/c1?tab=events');
    expect(describeNotification(n('event_reminder', event)).href).toBe('/events/e1');
    expect(describeNotification(n('post_comment', { postId: 'p1', preview: 'Nice', user })).href).toBe('/posts/p1');
    expect(describeNotification(n('post_like', { postId: '../evil', user })).href).toBeNull();
  });

  it('renders titles (event times in Almaty)', () => {
    render(<NotificationItem notification={n('event_new', event)} onRead={vi.fn()} />);
    expect(screen.getByRole('link', { name: /New event in Toyota Club KZ\s*: Sunday meetup\s*, Sun.*11:00/ })).toHaveAttribute('href', '/events/e1');
  });

  it.each([
    ['event_new', { ...event, change: 'updated' }, /Sunday meetup was changed/],
    ['event_new', { ...event, change: 'cancelled' }, /Sunday meetup was cancelled/],
    ['event_reminder', event, /Starting soon: Sunday meetup/],
    ['post_comment', { postId: 'p1', preview: 'Great photos!', user }, /Aidar K\. commented on your post: Great photos!/],
    ['post_like', { postId: 'p1', preview: '', user }, /Aidar K\. liked your post/],
  ] as const)('%s', (type, payload, name) => {
    render(<NotificationItem notification={n(type, payload)} onRead={vi.fn()} />);
    expect(screen.getByRole('link', { name })).toBeInTheDocument();
  });
});
