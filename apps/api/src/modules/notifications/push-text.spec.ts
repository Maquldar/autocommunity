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
