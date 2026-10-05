import { describe, expect, it } from 'vitest';
import { pushPayloadFor } from './push-text';

const user = { id: '0192f0c0-0000-7000-8000-000000000001', nickname: 'aidar', name: 'Айдар', avatarUrl: null, rating: 60 };

describe('pushPayloadFor', () => {
  it('localizes friend notifications by the recipient locale', () => {
    expect(pushPayloadFor('friend_request', { requestId: 'r', user }, 'ru')).toEqual({
      title: 'Заявка в друзья',
      body: 'Айдар (@aidar) хочет добавить вас в друзья',
      url: `/u/${user.id}`,
      tag: `friend_request:${user.id}`,
    });
    expect(pushPayloadFor('friend_accepted', { user }, 'en')).toMatchObject({
      title: 'New friend',
      body: 'Айдар (@aidar) accepted your friend request',
    });
  });

  it('falls back to ru for unknown locales and returns null for types without push text', () => {
    expect(pushPayloadFor('friend_accepted', { user }, 'de')?.title).toBe('Новый друг');
    expect(pushPayloadFor('post_like', { user }, 'ru')).toBeNull();
    expect(pushPayloadFor('friend_request', {}, 'ru')).toBeNull();
  });
});

describe('pushPayloadFor (communities)', () => {
  const c = { communityId: '0192f0c0-0000-7000-8000-0000000000cc', communityName: 'Land Cruiser Club' };

  it('renders request / approved / role texts with community links', () => {
    expect(pushPayloadFor('community_request', { ...c, user }, 'ru')).toEqual({
      title: 'Заявка в сообщество',
      body: 'Айдар (@aidar) хочет вступить в «Land Cruiser Club»',
      url: `/communities/${c.communityId}/requests`,
      tag: `community_request:${c.communityId}:${user.id}`,
    });
    expect(pushPayloadFor('community_approved', c, 'en')).toMatchObject({ body: "You've been accepted to “Land Cruiser Club”", url: `/communities/${c.communityId}` });
    expect(pushPayloadFor('community_role', { ...c, role: 'moderator' }, 'ru')?.body).toBe('Теперь вы — модератор сообщества «Land Cruiser Club»');
    expect(pushPayloadFor('community_role', { ...c, role: 'owner' }, 'en')?.body).toBe('You are now the owner of “Land Cruiser Club”');
  });
});

describe('pushPayloadFor (sos)', () => {
  const sosId = '0192f0c0-0000-7000-8000-0000000000aa';

  it('renders nearby / response / accepted / status texts', () => {
    expect(pushPayloadFor('sos_nearby', { sosId, type: 'flat_tire', distanceM: 1234, requester: user }, 'ru')).toEqual({
      title: '🆘 SOS рядом',
      body: 'Пробито колесо · 1.2 км от вас — Айдар (@aidar)',
      url: `/sos/${sosId}`,
      tag: `sos:${sosId}`,
    });
    expect(pushPayloadFor('sos_nearby', { sosId, type: 'battery', distanceM: 340, requester: user }, 'en')?.body).toBe('Dead battery · 340 m away — Айдар (@aidar)');
    expect(pushPayloadFor('sos_response', { sosId, responseId: 'r', helper: user }, 'en')?.body).toBe('Айдар (@aidar) offers to help');
    expect(pushPayloadFor('sos_accepted', { sosId, requester: user }, 'ru')?.body).toBe('Айдар (@aidar) принял(а) вашу помощь');
    expect(pushPayloadFor('sos_status', { sosId, status: 'accepted', event: 'withdrawn', actor: user }, 'ru')?.body).toBe('Айдар (@aidar) больше не может помочь');
    expect(pushPayloadFor('sos_status', { sosId, status: 'expired' }, 'en')?.body).toBe('Nobody responded, the SOS expired');
    expect(pushPayloadFor('sos_status', { status: 'closed' }, 'en')).toBeNull();
  });
});
