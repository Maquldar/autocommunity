import type { Locale, NotificationType, PushPayload, UserMini } from '@autoc/shared';
import { ADMIN_PUSH_TYPES, adminPushPayloadFor } from './admin-push-text';
import { isPhase9Type, PHASE9_PUSH_TYPES, phase9PushPayloadFor, type Phase9NotificationType } from './phase9-push-text';

type Ctx = {
  actor: string;
  community: string;
  role: string;
  sosType: string;
  distance: string;
  status: string;
  stars: string;
  /* phase 8 and the remaining types */
  title: string;
  when: string;
  place: string;
  preview: string;
  note: string;
  service: string;
  change: string;
};
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

/** Event times in push texts are Almaty wall-clock time (the pilot city). */
const PUSH_TIME_ZONE = 'Asia/Almaty';

function formatWhen(iso: unknown, l: Locale): string {
  if (typeof iso !== 'string') return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(l === 'ru' ? 'ru-RU' : 'en-GB', {
    timeZone: PUSH_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

const join = (...parts: string[]) => parts.filter(Boolean).join(' · ');

const SERVICE_STATUS_TEXT: Record<Locale, Record<string, string>> = {
  ru: { verified: 'проверен и опубликован', rejected: 'отклонён модератором', approved: 'подтверждён', pending: 'на проверке' },
  en: { verified: 'was verified and published', rejected: 'was rejected by a moderator', approved: 'was approved', pending: 'is under review' },
};

const REPORT_DECISION_TEXT: Record<Locale, Record<string, string>> = {
  ru: { confirm: 'Жалоба подтверждена, меры приняты', dismiss: 'Жалоба рассмотрена, нарушений не найдено' },
  en: { confirm: 'Your report was confirmed and action was taken', dismiss: 'Your report was reviewed; no violation was found' },
};

/** Every notification type has push text (enforced by the type: a missing key doesn't compile). */
const TEXTS: Record<Exclude<NotificationType, Phase9NotificationType>, Record<Locale, Texts>> = {
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
  message: {
    ru: { title: 'Новое сообщение', body: (c) => join(c.actor, c.preview) || 'Новое сообщение' },
    en: { title: 'New message', body: (c) => join(c.actor, c.preview) || 'New message' },
  },
  admin_warning: {
    ru: { title: 'Предупреждение от модератора', body: (c) => c.note || 'Пожалуйста, соблюдайте правила сообщества' },
    en: { title: 'Warning from a moderator', body: (c) => c.note || 'Please follow the community rules' },
  },
  event_new: {
    ru: {
      title: 'Новое событие',
      body: (c) =>
        c.change === 'cancelled'
          ? `Отменено: ${c.title}`
          : c.change === 'updated'
            ? `Изменено: ${join(c.title, c.when, c.place)}`
            : `«${c.community}»: ${join(c.title, c.when)}`,
    },
    en: {
      title: 'New event',
      body: (c) =>
        c.change === 'cancelled'
          ? `Cancelled: ${c.title}`
          : c.change === 'updated'
            ? `Updated: ${join(c.title, c.when, c.place)}`
            : `“${c.community}”: ${join(c.title, c.when)}`,
    },
  },
  event_reminder: {
    ru: { title: 'Скоро начало', body: (c) => join(c.title, c.when, c.place) },
    en: { title: 'Starting soon', body: (c) => join(c.title, c.when, c.place) },
  },
  post_comment: {
    ru: { title: 'Новый комментарий', body: (c) => (c.preview ? `${c.actor}: ${c.preview}` : `${c.actor} прокомментировал(а) ваш пост`) },
    en: { title: 'New comment', body: (c) => (c.preview ? `${c.actor}: ${c.preview}` : `${c.actor} commented on your post`) },
  },
  post_like: {
    ru: { title: 'Новая отметка «Нравится»', body: (c) => `${c.actor} нравится ваш пост` },
    en: { title: 'New like', body: (c) => `${c.actor} liked your post` },
  },
  service_status: {
    ru: { title: 'Статус автосервиса', body: (c) => `«${c.service}» ${c.status}` },
    en: { title: 'Service status', body: (c) => `“${c.service}” ${c.status}` },
  },
  visit_status: {
    ru: { title: 'Визит проверен', body: (c) => `Визит в «${c.service}» ${c.status}` },
    en: { title: 'Visit reviewed', body: (c) => `Your visit to “${c.service}” ${c.status}` },
  },
  report_resolved: {
    ru: { title: 'Жалоба рассмотрена', body: (c) => c.status },
    en: { title: 'Report reviewed', body: (c) => c.status },
  },
};

/** Every type with push text (all of NotificationType; see push-text.spec). */
export const PUSH_TEXT_TYPES = [...Object.keys(TEXTS), ...PHASE9_PUSH_TYPES] as NotificationType[];

const asLocale = (locale: string): Locale => (locale === 'en' ? 'en' : 'ru');

const actorLabel = (u: UserMini | undefined) => (!u ? '' : u.name && u.nickname ? `${u.name} (@${u.nickname})` : u.name || `@${u.nickname}`);

/**
 * Localized Web Push text for a notification, or null for types that aren't pushed yet. `url` is a web app
 * path the service worker opens on click; `tag` lets the browser replace an earlier push about the same thing.
 */
export function pushPayloadFor(type: NotificationType, payload: Record<string, unknown>, locale: string): PushPayload | null {
  const l = asLocale(locale);
  if (ADMIN_PUSH_TYPES.includes(type)) return adminPushPayloadFor(type, payload, l);
  if (isPhase9Type(type)) return phase9PushPayloadFor(type, payload, l);
  const texts = TEXTS[type]?.[l];
  if (!texts) return null;
  const user = (payload.user ?? payload.requester ?? payload.helper ?? payload.actor ?? payload.author ?? payload.sender) as UserMini | undefined;
  const sosId = typeof payload.sosId === 'string' ? payload.sosId : null;
  const meters = typeof payload.distanceM === 'number' ? payload.distanceM : null;
  const communityId = typeof payload.communityId === 'string' ? payload.communityId : null;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const postId = typeof payload.postId === 'string' ? payload.postId : null;
  const eventId = typeof payload.eventId === 'string' ? payload.eventId : null;
  const serviceId = typeof payload.serviceId === 'string' ? payload.serviceId : null;
  const statusText =
    type === 'service_status' || type === 'visit_status'
      ? (SERVICE_STATUS_TEXT[l][String(payload.status)] ?? String(payload.status ?? ''))
      : type === 'report_resolved'
        ? (REPORT_DECISION_TEXT[l][String(payload.decision)] ?? REPORT_DECISION_TEXT[l].dismiss!)
        : (SOS_STATUS_TEXT[l][String(payload.event ?? payload.status)] ?? String(payload.status ?? ''));
  const ctx: Ctx = {
    actor: actorLabel(user),
    community: typeof payload.communityName === 'string' ? payload.communityName : '',
    role: ROLE_NAMES[l][String(payload.role)] ?? String(payload.role ?? ''),
    sosType: SOS_TYPE_NAMES[l][String(payload.type)] ?? SOS_TYPE_NAMES[l].other!,
    distance: meters === null ? '' : meters < 1000 ? `${Math.round(meters / 10) * 10} ${l === 'ru' ? 'м' : 'm'}` : `${(meters / 1000).toFixed(1)} ${l === 'ru' ? 'км' : 'km'}`,
    stars: String(payload.stars ?? ''),
    status: statusText,
    title: str(payload.title),
    when: formatWhen(payload.startsAt, l),
    place: str(payload.place),
    preview: str(payload.preview ?? payload.text),
    note: str(payload.note),
    service: str(payload.serviceName),
    change: str(payload.change),
  };
  const make = (url: string, tag: string, title = texts.title): PushPayload => ({ title, body: texts.body(ctx), url, tag });
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
    case 'message': {
      const chatId = typeof payload.chatId === 'string' ? payload.chatId : null;
      return chatId ? make(`/chats/${chatId}`, `chat:${chatId}`, ctx.actor || texts.title) : null;
    }
    case 'admin_warning':
      return make('/notifications', `admin_warning:${str(payload.actionId) || 'latest'}`);
    case 'event_new': {
      if (!eventId) return null;
      const title = ctx.change === 'cancelled' ? (l === 'ru' ? 'Событие отменено' : 'Event cancelled') : ctx.change === 'updated' ? (l === 'ru' ? 'Событие изменено' : 'Event updated') : texts.title;
      // A cancelled event no longer exists: open its community instead.
      const url = ctx.change === 'cancelled' ? (communityId ? `/communities/${communityId}?tab=events` : '/events') : `/events/${eventId}`;
      return make(url, `event:${eventId}`, title);
    }
    case 'event_reminder':
      return eventId ? make(`/events/${eventId}`, `event_reminder:${eventId}`) : null;
    case 'post_comment':
      return postId && user ? make(`/posts/${postId}`, `post_comment:${postId}`) : null;
    case 'post_like':
      return postId && user ? make(`/posts/${postId}`, `post_like:${postId}`) : null;
    case 'service_status':
      return serviceId ? make(`/services/${serviceId}`, `service_status:${serviceId}`) : null;
    case 'visit_status':
      return serviceId ? make(`/services/${serviceId}`, `visit_status:${str(payload.visitId) || serviceId}`) : null;
    case 'report_resolved':
      return make('/notifications', `report_resolved:${str(payload.reportId) || 'latest'}`);
  }
}
