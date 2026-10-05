import { describe, expect, it } from 'vitest';
import { detectPushSupport, isIos, urlBase64ToUint8Array } from './push';

const chrome = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130', maxTouchPoints: 0, serviceWorker: {} };
const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari/604.1', maxTouchPoints: 5, serviceWorker: {} };
const ipad = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', maxTouchPoints: 5, serviceWorker: {} };

describe('push support', () => {
  it('detects iOS including iPadOS desktop UA', () => {
    expect(isIos(iphone)).toBe(true);
    expect(isIos(ipad)).toBe(true);
    expect(isIos(chrome)).toBe(false);
  });

  it('asks iOS users to install the app first', () => {
    expect(detectPushSupport({ navigator: iphone, hasPushManager: false, hasNotification: false, standalone: false })).toBe('ios-needs-install');
    expect(detectPushSupport({ navigator: iphone, hasPushManager: true, hasNotification: true, standalone: true })).toBe('supported');
  });

  it('needs a service worker, PushManager and Notification', () => {
    expect(detectPushSupport({ navigator: chrome, hasPushManager: true, hasNotification: true, standalone: false })).toBe('supported');
    expect(detectPushSupport({ navigator: chrome, hasPushManager: false, hasNotification: true, standalone: false })).toBe('unsupported');
    const noSw = { userAgent: chrome.userAgent, maxTouchPoints: 0 };
    expect(detectPushSupport({ navigator: noSw, hasPushManager: true, hasNotification: true, standalone: false })).toBe('unsupported');
  });

  it('decodes base64url VAPID keys', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID_-8'))).toEqual([1, 2, 3, 255, 239]);
  });
});
