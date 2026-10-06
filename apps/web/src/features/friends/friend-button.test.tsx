import type { Paginated, UserPublic } from '@autoc/shared';
import { QueryClient, QueryClientProvider, useQuery, type InfiniteData } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '../../../test/render';
import { FriendButton } from './friend-button';
import { applyOptimisticFriendAction, friendsKeys } from './queries';

const api = vi.hoisted(() => ({
  friends: {
    send: vi.fn(),
    accept: vi.fn(),
    decline: vi.fn(),
    cancel: vi.fn(),
    remove: vi.fn(),
    requests: vi.fn(),
  },
}));
vi.mock('@/lib/api', () => ({ api }));
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/toast', () => ({ notify }));

const user = (relation: UserPublic['relation']): UserPublic => ({
  id: 'u1',
  nickname: 'aidar',
  name: 'Aidar',
  avatarUrl: null,
  city: null,
  bio: null,
  rating: 60,
  createdAt: '2026-01-01T00:00:00Z',
  primaryVehicle: null,
  relation,
  status: 'active',
  isPremium: false,
  profileFrame: null,
  tier: 'silver',
});

/** What GET /users/u1 returns after the action (refetched on settle). */
let serverRelation: UserPublic['relation'] = 'none';

/** Reads the user from the cache like the profile page does, so optimistic updates re-render it. */
function Connected() {
  const { data } = useQuery({ queryKey: ['users', 'u1'], queryFn: () => user(serverRelation), staleTime: Infinity });
  if (!data) return null;
  return <FriendButton user={{ id: data.id, name: data.name, relation: data.relation }} />;
}

function setup(relation: UserPublic['relation']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(['users', 'u1'], user(relation));
  renderWithIntl(
    <QueryClientProvider client={client}>
      <Connected />
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  serverRelation = 'none';
});

describe('<FriendButton>', () => {
  it('Add → optimistic "Cancel request", then success toast', async () => {
    let resolve!: () => void;
    api.friends.send.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    serverRelation = 'request_out';
    setup('none');
    fireEvent.click(screen.getByRole('button', { name: 'Add friend' }));
    expect(await screen.findByRole('button', { name: 'Cancel request' })).toBeInTheDocument();
    expect(api.friends.send).toHaveBeenCalledWith('u1');
    resolve();
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Friend request sent to Aidar'));
  });

  it('rolls back when the request fails', async () => {
    api.friends.send.mockRejectedValue(new Error('boom'));
    const client = setup('none');
    fireEvent.click(screen.getByRole('button', { name: 'Add friend' }));
    await waitFor(() => expect(notify.error).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: 'Add friend' })).toBeInTheDocument();
    expect(client.getQueryData<UserPublic>(['users', 'u1'])?.relation).toBe('none');
  });

  it('request_in offers Accept and Decline; Accept without an id re-sends (auto-accept)', async () => {
    api.friends.send.mockResolvedValue({ id: 'r1', status: 'accepted' });
    serverRelation = 'friend';
    setup('request_in');
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('button', { name: /Friends/ })).toBeInTheDocument();
    expect(api.friends.send).toHaveBeenCalledWith('u1');
  });

  it('request_out cancels after looking up the request id', async () => {
    api.friends.requests.mockResolvedValue({ items: [{ id: 'r9', user: user('request_out'), createdAt: '' }], nextCursor: null });
    api.friends.cancel.mockResolvedValue(undefined);
    setup('request_out');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    await waitFor(() => expect(api.friends.cancel).toHaveBeenCalledWith('r9'));
    expect(api.friends.requests).toHaveBeenCalledWith('out', { cursor: null, limit: 50 });
  });

  it('friend → menu → confirm → unfriend', async () => {
    api.friends.remove.mockResolvedValue(undefined);
    setup('friend');
    const trigger = screen.getByRole('button', { name: /Friends/ });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove from friends' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Aidar from friends?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove from friends' }));
    await waitFor(() => expect(api.friends.remove).toHaveBeenCalledWith('u1'));
    expect(await screen.findByRole('button', { name: 'Add friend' })).toBeInTheDocument();
  });

  it('renders nothing for yourself', () => {
    const client = new QueryClient();
    const { container } = renderWithIntl(
      <QueryClientProvider client={client}>
        <FriendButton user={{ id: 'me', name: 'Me', relation: 'self' }} />
      </QueryClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('applyOptimisticFriendAction', () => {
  it('updates search results and drops handled requests, returning a snapshot for rollback', () => {
    const client = new QueryClient();
    const search: InfiniteData<Paginated<UserPublic>> = { pages: [{ items: [user('request_in')], nextCursor: null }], pageParams: [null] };
    client.setQueryData(['users', 'search', 'aid'], search);
    client.setQueryData(friendsKeys.requests('in'), {
      pages: [{ items: [{ id: 'r1', user: user('request_in'), createdAt: '' }], nextCursor: null }],
      pageParams: [null],
    });
    const snapshot = applyOptimisticFriendAction(client, { user: { id: 'u1', name: 'Aidar', relation: 'request_in' }, action: 'accept', requestId: 'r1' });
    const after = client.getQueryData<InfiniteData<Paginated<UserPublic>>>(['users', 'search', 'aid'])!;
    expect(after.pages[0]!.items[0]!.relation).toBe('friend');
    expect(client.getQueryData<InfiniteData<Paginated<unknown>>>(friendsKeys.requests('in'))!.pages[0]!.items).toEqual([]);
    for (const [key, data] of snapshot) client.setQueryData(key, data);
    expect(client.getQueryData<InfiniteData<Paginated<UserPublic>>>(['users', 'search', 'aid'])!.pages[0]!.items[0]!.relation).toBe('request_in');
  });
});
