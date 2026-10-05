import type { Locale, NotificationType, PushPayload, UserMini } from '@autoc/shared';

type Texts = { title: string; body: (actor: string) => string };

const TEXTS: Partial<Record<NotificationType, Record<Locale, Texts>>> = {
  friend_request: {
    ru: { title: 'Заявка в друзья', body: (a) => `${a} хочет добавить вас в друзья` },
    en: { title: 'Friend request', body: (a) => `${a} wants to be your friend` },
  },
  friend_accepted: {
    ru: { title: 'Новый друг', body: (a) => `${a} принял(а) вашу заявку в друзья` },
    en: { title: 'New friend', body: (a) => `${a} accepted your friend request` },
  },
};

const asLocale = (locale: string): Locale => (locale === 'en' ? 'en' : 'ru');

const actorLabel = (u: UserMini) => (u.name && u.nickname ? `${u.name} (@${u.nickname})` : u.name || `@${u.nickname}`);

/**
 * Localized Web Push text for a notification, or null for types that aren't pushed yet. `url` is a web app
 * path the service worker opens on click; `tag` lets the browser replace an earlier push about the same thing.
 */
export function pushPayloadFor(type: NotificationType, payload: Record<string, unknown>, locale: string): PushPayload | null {
  const texts = TEXTS[type]?.[asLocale(locale)];
  const user = payload.user as UserMini | undefined;
  if (!texts || !user) return null;
  switch (type) {
    case 'friend_request':
      return { title: texts.title, body: texts.body(actorLabel(user)), url: `/u/${user.id}`, tag: `friend_request:${user.id}` };
    case 'friend_accepted':
      return { title: texts.title, body: texts.body(actorLabel(user)), url: `/u/${user.id}`, tag: `friend_accepted:${user.id}` };
    default:
      return null;
  }
}
