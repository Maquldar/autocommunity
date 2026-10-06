import type { NotificationType } from '@autoc/shared';
import { describe, expect, it } from 'vitest';
import { PUSH_TEXT_TYPES, pushPayloadFor } from './push-text';

const user = { id: '0192f0c0-0000-7000-8000-000000000001', nickname: 'aidar', name: 'Айдар', avatarUrl: null, rating: 60, isPremium: false };

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

describe('pushPayloadFor (reviews)', () => {
  it('renders review_received', () => {
    expect(pushPayloadFor('review_received', { reviewId: 'r1', sosId: 's', stars: 5, author: user }, 'ru')).toEqual({
      title: 'Новый отзыв',
      body: 'Айдар (@aidar) оценил(а) вас на 5★',
      url: `/u/${user.id}?tab=reviews`,
      tag: 'review:r1',
    });
  });
});

describe('pushPayloadFor (phase 8: events, feed and the remaining types)', () => {
  const eventId = '0192f0c0-0000-7000-8000-0000000000e1';
  const communityId = '0192f0c0-0000-7000-8000-0000000000c1';
  const event = { eventId, communityId, communityName: 'Toyota Club KZ', title: 'Встреча клуба', startsAt: '2026-10-10T06:00:00.000Z', place: 'Достык Плаза' };

  it('event_new: new / updated / cancelled, times in Asia/Almaty', () => {
    expect(pushPayloadFor('event_new', event, 'ru')).toEqual({
      title: 'Новое событие',
      body: '«Toyota Club KZ»: Встреча клуба · 10 окт., 11:00',
      url: `/events/${eventId}`,
      tag: `event:${eventId}`,
    });
    expect(pushPayloadFor('event_new', { ...event, change: 'updated' }, 'en')).toMatchObject({
      title: 'Event updated',
      body: 'Updated: Встреча клуба · 10 Oct, 11:00 · Достык Плаза',
      url: `/events/${eventId}`,
    });
    expect(pushPayloadFor('event_new', { ...event, change: 'cancelled' }, 'ru')).toMatchObject({
      title: 'Событие отменено',
      body: 'Отменено: Встреча клуба',
      url: `/communities/${communityId}?tab=events`,
    });
  });

  it('event_reminder, post_comment, post_like', () => {
    expect(pushPayloadFor('event_reminder', event, 'en')).toEqual({
      title: 'Starting soon',
      body: 'Встреча клуба · 10 Oct, 11:00 · Достык Плаза',
      url: `/events/${eventId}`,
      tag: `event_reminder:${eventId}`,
    });
    const postId = '0192f0c0-0000-7000-8000-0000000000a1';
    expect(pushPayloadFor('post_comment', { postId, commentId: 'c', preview: 'Отличная идея!', user }, 'ru')).toEqual({
      title: 'Новый комментарий',
      body: 'Айдар (@aidar): Отличная идея!',
      url: `/posts/${postId}`,
      tag: `post_comment:${postId}`,
    });
    expect(pushPayloadFor('post_like', { postId, preview: '', user }, 'en')).toMatchObject({ body: 'Айдар (@aidar) liked your post', url: `/posts/${postId}` });
  });
});

/** One representative payload per type. `Record<NotificationType, …>` makes a missing type a compile error. */
const SAMPLES: Record<NotificationType, Record<string, unknown>> = {
  friend_request: { requestId: 'r', user },
  friend_accepted: { user },
  community_request: { communityId: 'c1', communityName: 'Club', user },
  community_approved: { communityId: 'c1', communityName: 'Club' },
  community_role: { communityId: 'c1', communityName: 'Club', role: 'moderator' },
  sos_nearby: { sosId: 's1', type: 'battery', distanceM: 500, requester: user },
  sos_response: { sosId: 's1', responseId: 'r', helper: user },
  sos_accepted: { sosId: 's1', requester: user },
  sos_status: { sosId: 's1', status: 'closed' },
  review_received: { reviewId: 'rv', sosId: 's1', stars: 5, author: user },
  message: { chatId: 'ch1', sender: user, text: 'Привет' },
  admin_warning: { kind: 'warning', note: 'Не спамьте в чатах' },
  event_new: { eventId: 'e1', communityId: 'c1', communityName: 'Club', title: 'Meetup', startsAt: '2026-10-10T06:00:00.000Z', place: 'Mega' },
  event_reminder: { eventId: 'e1', communityId: 'c1', communityName: 'Club', title: 'Meetup', startsAt: '2026-10-10T06:00:00.000Z', place: 'Mega' },
  post_comment: { postId: 'p1', commentId: 'c', preview: 'Nice', user },
  post_like: { postId: 'p1', preview: 'Nice', user },
  service_status: { serviceId: 'sv1', serviceName: 'Шиномонтаж', status: 'verified' },
  visit_status: { visitId: 'v1', serviceId: 'sv1', serviceName: 'Шиномонтаж', status: 'approved' },
  report_resolved: { reportId: 'rp1', decision: 'confirm' },
  wallet_received: { transactionId: 'tx1', amount: 1500, message: 'За бензин', user },
  wallet_admin: { action: 'adjust', amount: -200, balance: 800, note: 'Исправление ошибки' },
  premium_reminder: { periodEnd: '2026-11-05T06:00:00.000Z', autoRenew: true, lowBalance: true, priceCoins: 1490, balance: 300 },
  premium_renewed: { periodEnd: '2026-12-05T06:00:00.000Z', priceCoins: 1490, balance: 10 },
  premium_expired: { reason: 'insufficient_funds' },
  vote_received: { voteId: 'v1', value: -1, reason: 'rude' },
  violation_reported: { violationId: 'vi1', vehicleId: 've1', category: 'speeding', vehicle: 'Toyota Camry' },
  violation_status: { violationId: 'vi1', vehicleId: 've1', category: 'speeding', status: 'approved', role: 'owner' },
  purchase_paid: { orderId: 'o1', serviceId: 'sv1', pointName: 'RP', total: 1225, method: 'coins' },
};

describe('push text completeness (F-43)', () => {
  it('covers every NotificationType', () => {
    expect([...PUSH_TEXT_TYPES].sort()).toEqual(Object.keys(SAMPLES).sort());
  });

  for (const type of Object.keys(SAMPLES) as NotificationType[]) {
    it(`${type}: localized title, body and a same-origin url in ru and en`, () => {
      for (const locale of ['ru', 'en'] as const) {
        const push = pushPayloadFor(type, SAMPLES[type], locale);
        expect(push, `${type}/${locale}`).not.toBeNull();
        expect(push!.title.trim()).not.toBe('');
        expect(push!.body.trim()).not.toBe('');
        expect(push!.url).toMatch(/^\/(?!\/)/);
        expect(push!.tag).toMatch(new RegExp(`^[a-z_]+:`));
      }
    });
  }
});
