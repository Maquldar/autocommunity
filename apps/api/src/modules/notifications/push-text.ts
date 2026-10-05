import type { Locale, NotificationType, PushPayload, UserMini } from '@autoc/shared';

type Ctx = { actor: string; community: string; role: string };
type Texts = { title: string; body: (c: Ctx) => string };

const ROLE_NAMES: Record<Locale, Record<string, string>> = {
  ru: { owner: 'владелец', moderator: 'модератор', member: 'участник' },
  en: { owner: 'the owner', moderator: 'a moderator', member: 'a member' },
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
  const user = payload.user as UserMini | undefined;
  const communityId = typeof payload.communityId === 'string' ? payload.communityId : null;
  const ctx: Ctx = {
    actor: actorLabel(user),
    community: typeof payload.communityName === 'string' ? payload.communityName : '',
    role: ROLE_NAMES[l][String(payload.role)] ?? String(payload.role ?? ''),
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
    default:
      return null;
  }
}
