import type { NotificationDto } from '@autoc/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '../../../test/render';
import { describeNotification, parseUserMini } from './describe';
import { NotificationItem } from './notification-item';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const aidar = { id: 'u1', nickname: 'aidar', name: 'Aidar K.', avatarUrl: null, rating: 72 };
const base = { readAt: null, createdAt: new Date(Date.now() - 5 * 60_000).toISOString() };
const friendRequest: NotificationDto = { id: 'n1', type: 'friend_request', payload: { requestId: 'r1', user: aidar }, ...base };
const friendAccepted: NotificationDto = { id: 'n2', type: 'friend_accepted', payload: { user: aidar }, ...base };
// A type this client doesn't know yet (a newer API), rendered generically.
const FUTURE = 'some_future_type' as NotificationDto['type'];
const unknown: NotificationDto = { id: 'n3', type: FUTURE, payload: { foo: 1 }, ...base };

/** Clicks a link without jsdom trying (and failing) to navigate. */
function clickLink(link: HTMLElement) {
  link.addEventListener('click', (event) => event.preventDefault());
  fireEvent.click(link);
}

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return renderWithIntl(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('describeNotification', () => {
  it('reads friend_request payloads', () => {
    expect(describeNotification(friendRequest)).toEqual({ kind: 'friend_request', user: aidar, requestId: 'r1', href: '/u/u1' });
  });
  it('reads friend_accepted payloads', () => {
    expect(describeNotification(friendAccepted)).toEqual({ kind: 'friend_accepted', user: aidar, href: '/u/u1' });
  });
  it('falls back to generic for other types, with a same-origin url only', () => {
    expect(describeNotification(unknown)).toEqual({ kind: 'generic', type: FUTURE, href: null });
    expect(describeNotification({ type: FUTURE, payload: { url: '/events/1' } }).href).toBe('/events/1');
    expect(describeNotification({ type: FUTURE, payload: { url: 'https://evil.example' } }).href).toBeNull();
    expect(describeNotification({ type: FUTURE, payload: { url: '//evil.example' } }).href).toBeNull();
  });
  it('tolerates malformed payloads', () => {
    expect(describeNotification({ type: 'friend_request', payload: { user: 'x' } })).toEqual({
      kind: 'friend_request',
      user: null,
      requestId: null,
      href: null,
    });
    expect(parseUserMini({ id: 'u2', nickname: 'nick' })).toEqual({ id: 'u2', nickname: 'nick', name: 'nick', avatarUrl: null, rating: 50 });
  });
});

describe('<NotificationItem>', () => {
  it('renders a friend request with inline Accept / Decline and unread marker', () => {
    render(<NotificationItem notification={friendRequest} onRead={vi.fn()} />);
    expect(screen.getByRole('link', { name: /Aidar K\. wants to add you as a friend/ })).toHaveAttribute('href', '/u/u1');
    expect(screen.getByText('Unread:', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument();
    expect(screen.getByText('5 minutes ago')).toBeInTheDocument();
  });

  it('renders friend_accepted without actions and marks read on click', () => {
    const onRead = vi.fn();
    render(<NotificationItem notification={friendAccepted} onRead={onRead} />);
    const link = screen.getByRole('link', { name: /Aidar K\. accepted your friend request/ });
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    clickLink(link);
    expect(onRead).toHaveBeenCalledWith(friendAccepted);
  });

  it('renders unknown types generically and marks read on click', () => {
    const onRead = vi.fn();
    render(<NotificationItem notification={unknown} onRead={onRead} />);
    fireEvent.click(screen.getByRole('button', { name: /New notification/ }));
    expect(onRead).toHaveBeenCalledTimes(1);
  });

  it('read notifications have no unread marker and are not re-marked', () => {
    const onRead = vi.fn();
    render(<NotificationItem notification={{ ...friendAccepted, readAt: base.createdAt }} onRead={onRead} />);
    expect(screen.queryByText('Unread:', { exact: false })).toBeNull();
    clickLink(screen.getByRole('link'));
    expect(onRead).not.toHaveBeenCalled();
  });

  it('falls back to "A driver" when the payload has no user', () => {
    render(<NotificationItem notification={{ ...friendAccepted, payload: {} }} onRead={vi.fn()} />);
    expect(screen.getByText('A driver')).toBeInTheDocument();
  });
});

describe('community notifications', () => {
  const community = { communityId: 'c1', communityName: 'Night Drive' };
  it('community_request links to the Requests tab and names both', () => {
    const n: NotificationDto = { id: 'n10', type: 'community_request', payload: { ...community, user: aidar }, ...base };
    expect(describeNotification(n)).toMatchObject({ kind: 'community_request', href: '/communities/c1/requests' });
    render(<NotificationItem notification={n} onRead={vi.fn()} />);
    expect(screen.getByRole('link', { name: /Aidar K\. wants to join Night Drive/ })).toHaveAttribute('href', '/communities/c1/requests');
  });
  it('community_approved and community_role link to the community', () => {
    const approved: NotificationDto = { id: 'n11', type: 'community_approved', payload: community, ...base };
    render(<NotificationItem notification={approved} onRead={vi.fn()} />);
    expect(screen.getByRole('link', { name: /accepted into Night Drive/ })).toHaveAttribute('href', '/communities/c1');
    const role: NotificationDto = { id: 'n12', type: 'community_role', payload: { ...community, role: 'moderator' }, ...base };
    render(<NotificationItem notification={role} onRead={vi.fn()} />);
    expect(screen.getByRole('link', { name: /now a moderator of Night Drive/ })).toHaveAttribute('href', '/communities/c1');
  });
  it('rejects unsafe ids', () => {
    expect(describeNotification({ type: 'community_approved', payload: { communityId: '../x', communityName: 'A' } }).href).toBeNull();
  });
});

describe('SOS and review notifications', () => {
  it('describe SOS payloads with links to the SOS', () => {
    expect(describeNotification({ type: 'sos_nearby', payload: { sosId: 's-1', type: 'fuel', distanceM: 900, requester: aidar } })).toEqual({
      kind: 'sos_nearby',
      sosId: 's-1',
      sosType: 'fuel',
      distanceM: 900,
      user: aidar,
      href: '/sos/s-1',
    });
    expect(describeNotification({ type: 'sos_status', payload: { sosId: 's-1', status: 'accepted', event: 'withdrawn', actor: aidar } })).toMatchObject({
      kind: 'sos_status',
      event: 'withdrawn',
      href: '/sos/s-1',
    });
    expect(describeNotification({ type: 'sos_status', payload: { sosId: 's-1', status: 'expired' } })).toMatchObject({ event: 'expired' });
    expect(describeNotification({ type: 'review_received', payload: { stars: 5, author: aidar } })).toMatchObject({ kind: 'review_received', href: '/profile#reviews' });
  });

  it('renders titles with the event', () => {
    const n = (type: NotificationDto['type'], payload: Record<string, unknown>): NotificationDto => ({ id: `x-${type}`, type, payload, ...base });
    render(<NotificationItem notification={n('sos_status', { sosId: 's1', status: 'accepted', event: 'arrived', actor: aidar })} onRead={vi.fn()} />);
    expect(screen.getByRole('link', { name: /Aidar K\. has arrived/ })).toHaveAttribute('href', '/sos/s1');
    render(<NotificationItem notification={n('sos_nearby', { sosId: 's2', type: 'battery', distanceM: 1200, requester: aidar })} onRead={vi.fn()} />);
    expect(screen.getByRole('link', { name: /Aidar K\. needs help nearby: Dead battery, 1\.2 km/ })).toBeInTheDocument();
    render(<NotificationItem notification={n('review_received', { stars: 4, author: aidar })} onRead={vi.fn()} />);
    expect(screen.getByRole('link', { name: /Aidar K\. rated you 4 stars/ })).toBeInTheDocument();
  });
});
