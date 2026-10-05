import type { Locale, NotificationType, PushPayload, UserMini } from '@autoc/shared';

type Ctx = { actor: string; community: string; role: string; sosType: string; distance: string; status: string; stars: string };
type Texts = { title: string; body: (c: Ctx) => string };

const ROLE_NAMES: Record<Locale, Record<string, string>> = {
  ru: { owner: 'владелец', moderator: 'модератор', member: 'участник' },
  en: { owner: 'the owner', moderator: 'a moderator', member: 'a member' },
};

const SOS_TYPE_NAMES: Record<Locale, Record<string, string>> = {
  ru: { flat_tire: 'Пробито колесо', battery: 'Сел аккумулятор', fuel: 'Закончилось топливо', stuck: 'Застрял(а)', breakdown: 'Поломка', accident: 'ДТП', tow: 'Нужен эвакуатор', other: 'Нужна помощь' },
  en: { flat_tire: 'Flat tire', battery: 'Dead battery', fuel: 'Out of fuel', stuck: 'Stuck', breakdown: 'Breakdown', accident: 'Accident', tow: 'Tow needed', other: 'Needs help' },
};

/** Status-change texts for `sos_status`, by the event the recipient is told about. */
const SOS_STATUS_TEXT: Record<Locale, Record<string, string>> = {
  ru: {
    withdrawn: '{actor} больше не может помочь',
    declined: 'Ваше предложение помощи отклонено',
    arrived: '{actor} на месте',
    in_progress: 'Помощь на месте',
    closed: 'SOS закрыт — спасибо за помощь!',
    cancelled: 'SOS отменён',
    expired: 'Никто не откликнулся, SOS истёк',
    timeout: 'SOS закрыт автоматически: прошло 24 часа',
  },
  en: {
    withdrawn: '{actor} can no longer help',
    declined: 'Your offer to help was declined',
    arrived: '{actor} has arrived',
    in_progress: 'Help has arrived',
    closed: 'SOS closed — thanks for helping!',
    cancelled: 'SOS cancelled',
    expired: 'Nobody responded, the SOS expired',
    timeout: 'SOS closed automatically after 24 hours',
  },
};

const TEXTS: Partial<Record<NotificationType, Record<Locale, Texts>>> = {
  friend_request: {
    ru: { title: 'Заявка в друзья', body: (c) => `${c.actor} хочет добавить вас в друзья` },
    en: { title: 'Friend request', body: (c) => `${c.actor} wants to be your friend` },
  },
  friend_accepted: {
    ru: { title: 'Новый друг', body: (c) => `${c.actor} принял(а) вашу заявку в друзья` },
    en: { title: 'New friend', body: (c) => `${c.actor} accepted your friend request` },
  },
  community_request: {
    ru: { title: 'Заявка в сообщество', body: (c) => `${c.actor} хочет вступить в «${c.community}»` },
    en: { title: 'Join request', body: (c) => `${c.actor} wants to join “${c.community}”` },
  },
  community_approved: {
    ru: { title: 'Заявка одобрена', body: (c) => `Вас приняли в «${c.community}»` },
    en: { title: 'Request approved', body: (c) => `You've been accepted to “${c.community}”` },
  },
  review_received: {
    ru: { title: 'Новый отзыв', body: (c) => `${c.actor} оценил(а) вас на ${c.stars}★` },
    en: { title: 'New review', body: (c) => `${c.actor} rated you ${c.stars}★` },
  },
  sos_nearby: {
    ru: { title: '🆘 SOS рядом', body: (c) => `${c.sosType} · ${c.distance} от вас — ${c.actor}` },
    en: { title: '🆘 SOS nearby', body: (c) => `${c.sosType} · ${c.distance} away — ${c.actor}` },
  },
  sos_response: {
    ru: { title: 'Предложение помощи', body: (c) => `${c.actor} готов(а) помочь` },
    en: { title: 'Offer to help', body: (c) => `${c.actor} offers to help` },
  },
  sos_accepted: {
    ru: { title: 'Вас ждут', body: (c) => `${c.actor} принял(а) вашу помощь` },
    en: { title: "You're helping", body: (c) => `${c.actor} accepted your help` },
  },
  sos_status: {
    ru: { title: 'SOS', body: (c) => c.status.replace('{actor}', c.actor) },
    en: { title: 'SOS', body: (c) => c.status.replace('{actor}', c.actor) },
  },
  community_role: {
    ru: { title: 'Новая роль', body: (c) => `Теперь вы — ${c.role} сообщества «${c.community}»` },
    en: { title: 'New role', body: (c) => `You are now ${c.role} of “${c.community}”` },
  },
};

const asLocale = (locale: string): Locale => (locale === 'en' ? 'en' : 'ru');

const actorLabel = (u: UserMini | undefined) => (!u ? '' : u.name && u.nickname ? `${u.name} (@${u.nickname})` : u.name || `@${u.nickname}`);

/**
 * Localized Web Push text for a notification, or null for types that aren't pushed yet. `url` is a web app
 * path the service worker opens on click; `tag` lets the browser replace an earlier push about the same thing.
 */
export function pushPayloadFor(type: NotificationType, payload: Record<string, unknown>, locale: string): PushPayload | null {
  const l = asLocale(locale);
  const texts = TEXTS[type]?.[l];
  if (!texts) return null;
  const user = (payload.user ?? payload.requester ?? payload.helper ?? payload.actor ?? payload.author) as UserMini | undefined;
  const sosId = typeof payload.sosId === 'string' ? payload.sosId : null;
  const meters = typeof payload.distanceM === 'number' ? payload.distanceM : null;
  const communityId = typeof payload.communityId === 'string' ? payload.communityId : null;
  const ctx: Ctx = {
    actor: actorLabel(user),
    community: typeof payload.communityName === 'string' ? payload.communityName : '',
    role: ROLE_NAMES[l][String(payload.role)] ?? String(payload.role ?? ''),
    sosType: SOS_TYPE_NAMES[l][String(payload.type)] ?? SOS_TYPE_NAMES[l].other!,
    distance: meters === null ? '' : meters < 1000 ? `${Math.round(meters / 10) * 10} ${l === 'ru' ? 'м' : 'm'}` : `${(meters / 1000).toFixed(1)} ${l === 'ru' ? 'км' : 'km'}`,
    stars: String(payload.stars ?? ''),
    status: SOS_STATUS_TEXT[l][String(payload.event ?? payload.status)] ?? String(payload.status ?? ''),
  };
  const make = (url: string, tag: string): PushPayload => ({ title: texts.title, body: texts.body(ctx), url, tag });
  switch (type) {
    case 'friend_request':
      return user ? make(`/u/${user.id}`, `friend_request:${user.id}`) : null;
    case 'friend_accepted':
      return user ? make(`/u/${user.id}`, `friend_accepted:${user.id}`) : null;
    case 'community_request':
      return user && communityId ? make(`/communities/${communityId}/requests`, `community_request:${communityId}:${user.id}`) : null;
    case 'community_approved':
      return communityId ? make(`/communities/${communityId}`, `community_approved:${communityId}`) : null;
    case 'community_role':
      return communityId ? make(`/communities/${communityId}`, `community_role:${communityId}`) : null;
    case 'review_received':
      return user ? make(`/u/${user.id}?tab=reviews`, `review:${String(payload.reviewId)}`) : null;
    case 'sos_nearby':
    case 'sos_response':
    case 'sos_accepted':
    case 'sos_status':
      return sosId ? make(`/sos/${sosId}`, `sos:${sosId}`) : null;
    default:
      return null;
  }
}
