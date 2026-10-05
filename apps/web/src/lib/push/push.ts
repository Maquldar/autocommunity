import { api } from '@/lib/api';

/**
 * Web Push (VAPID) on the client: service-worker registration, support detection, subscribe and
 * unsubscribe. Permission is only ever requested from a user action (the Settings switch).
 */

export const SW_URL = '/sw.js';

export type PushSupport =
  | 'supported'
  /** iOS/iPadOS Safari: Web Push only works in the installed (Home Screen) app. */
  | 'ios-needs-install'
  | 'unsupported';

type NavigatorLike = Pick<Navigator, 'userAgent' | 'maxTouchPoints'> & { standalone?: boolean; serviceWorker?: unknown };

export function isIos(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'>): boolean {
  // iPadOS 13+ reports a Mac user agent; touch points give it away.
  return /iPhone|iPad|iPod/i.test(nav.userAgent) || (/Macintosh/i.test(nav.userAgent) && nav.maxTouchPoints > 1);
}

export function detectPushSupport(
  env: { navigator?: NavigatorLike; hasPushManager?: boolean; hasNotification?: boolean; standalone?: boolean } = {},
): PushSupport {
  const nav = env.navigator ?? (typeof navigator !== 'undefined' ? (navigator as NavigatorLike) : undefined);
  if (!nav) return 'unsupported';
  const hasSw = 'serviceWorker' in nav;
  const hasPush = env.hasPushManager ?? (typeof window !== 'undefined' && 'PushManager' in window);
  const hasNotification = env.hasNotification ?? (typeof window !== 'undefined' && 'Notification' in window);
  const standalone =
    env.standalone ??
    (nav.standalone === true || (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches));
  if (isIos(nav) && !standalone) return 'ios-needs-install';
  return hasSw && hasPush && hasNotification ? 'supported' : 'unsupported';
}

/** VAPID public key (base64url) → the bytes PushManager.subscribe expects. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** Registers the worker once per page load (push needs it; it has no fetch handler). */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(SW_URL, { scope: '/' });
  } catch {
    return null;
  }
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration('/')) ?? (await registerServiceWorker());
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  const registration = await getRegistration();
  if (!registration?.pushManager) return null;
  return registration.pushManager.getSubscription();
}

export class PushError extends Error {
  constructor(readonly reason: 'denied' | 'not-configured' | 'unsupported') {
    super(reason);
    this.name = 'PushError';
  }
}

/** Asks for permission (must run inside a user gesture), subscribes and registers with the API. */
export async function enablePush(): Promise<PushSubscription> {
  if (detectPushSupport() !== 'supported') throw new PushError('unsupported');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new PushError('denied');
  const { key } = await api.push.vapidPublicKey();
  if (!key) throw new PushError('not-configured');
  const registration = await getRegistration();
  if (!registration?.pushManager) throw new PushError('unsupported');
  await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  const keyBytes = urlBase64ToUint8Array(key);
  if (subscription && !sameKey(subscription, keyBytes)) {
    // Server key rotated: the old subscription can't receive our pushes.
    await subscription.unsubscribe().catch(() => undefined);
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes });
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new PushError('unsupported');
  await api.push.subscribe({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
  return subscription;
}

function sameKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const current = subscription.options?.applicationServerKey;
  if (!current) return true;
  const bytes = new Uint8Array(current);
  return bytes.length === key.length && bytes.every((b, i) => b === key[i]);
}

/** Unsubscribes this browser and tells the API (best effort; used by the switch and on logout). */
export async function disablePush(): Promise<void> {
  const subscription = await getCurrentSubscription().catch(() => null);
  if (!subscription) return;
  const { endpoint } = subscription;
  await Promise.allSettled([api.push.unsubscribe(endpoint), subscription.unsubscribe()]);
}
