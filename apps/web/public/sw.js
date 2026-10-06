/* AutoCommunity service worker: Web Push only (no fetch handler, no offline caching yet). */
/* global self, clients */
'use strict';

const DEFAULT_ICON = '/icons/icon-192.png';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Accepts only same-origin paths so a payload can't open an arbitrary site: a single leading '/', no
 * backslashes ('/\evil.com' is protocol-relative to the URL parser) and no control characters (tabs and
 * newlines are stripped by the URL parser, so '/\t/evil.com' would become '//evil.com').
 */
function safeUrl(value) {
  if (typeof value !== 'string' || value[0] !== '/' || value[1] === '/' || value.includes('\\')) return '/notifications';
  if (/[\u0000-\u001f\u007f]/.test(value)) return '/notifications';
  return value;
}

/** PushPayload: { title, body, url, tag } (API.md §2), localized by the server. */
function parsePayload(event) {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { body: event.data ? event.data.text() : '' };
  }
  return {
    title: typeof data.title === 'string' && data.title ? data.title : 'AutoCommunity',
    body: typeof data.body === 'string' ? data.body : '',
    url: safeUrl(data.url),
    tag: typeof data.tag === 'string' && data.tag ? data.tag : undefined,
  };
}

self.addEventListener('push', (event) => {
  const payload = parsePayload(event);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      renotify: Boolean(payload.tag),
      icon: DEFAULT_ICON,
      badge: '/icons/favicon-32.png',
      data: { url: payload.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = safeUrl(event.notification.data && event.notification.data.url);
  const target = new URL(url, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Prefer a tab already on the target, then any app tab (navigate it), then a new window.
      const exact = windows.find((client) => client.url === target);
      if (exact) return exact.focus();
      const any = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (any) {
        await any.focus();
        if ('navigate' in any) return any.navigate(target).catch(() => clients.openWindow(target));
        return undefined;
      }
      return clients.openWindow(target);
    })(),
  );
});
