import { describe, expect, it } from 'vitest';
import { isAllowedPushEndpoint } from './push-endpoint';

describe('isAllowedPushEndpoint', () => {
  it('accepts the browsers push services', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc:def')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/gAAA')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/QGx')).toBe(true);
    expect(isAllowedPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true);
  });

  it('rejects anything else (SSRF)', () => {
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/abc')).toBe(false);
    expect(isAllowedPushEndpoint('https://localhost/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://169.254.169.254/latest')).toBe(false);
    expect(isAllowedPushEndpoint('https://evil.com/fcm.googleapis.com')).toBe(false);
    expect(isAllowedPushEndpoint('https://googleapis.com.evil.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com:8443/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://user:pw@fcm.googleapis.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('not a url')).toBe(false);
  });
});
