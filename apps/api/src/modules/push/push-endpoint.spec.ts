import { describe, expect, it } from 'vitest';
import { isAllowedPushEndpoint, normalizePushEndpoint } from './push-endpoint';

describe('push endpoint allow-list', () => {
  it('accepts the browsers push services and normalizes the URL', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc:def')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/gAAA')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/QGx')).toBe(true);
    expect(isAllowedPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true);
    expect(normalizePushEndpoint('https://FCM.googleapis.com:443/fcm/send/x')).toBe('https://fcm.googleapis.com/fcm/send/x');
  });

  it('rejects other hosts, schemes, ports, credentials and IP literals', () => {
    for (const ep of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://localhost/x',
      'https://169.254.169.254/latest',
      'https://[::1]/x',
      'https://evil.com/fcm.googleapis.com',
      'https://googleapis.com.evil.com/x',
      'https://fcm.googleapis.com.evil.com/x',
      'https://android.googleapis.com/gcm/send/x', // not on the exact list
      'https://storage.googleapis.com/x',
      'https://fcm.googleapis.com:8443/x',
      'https://user:pw@fcm.googleapis.com/x',
      'https://user@fcm.googleapis.com/x',
      'not a url',
    ]) {
      expect(isAllowedPushEndpoint(ep), ep).toBe(false);
    }
  });

  it('rejects parser-differential bypasses (legacy url.parse vs WHATWG URL)', () => {
    for (const ep of [
      'https://127.0.0.1;.googleapis.com/ssrf-proof',
      'https://localhost;.mozilla.com/x',
      'https://169.254.169.254;.googleapis.com/latest/meta-data',
      'https://127.0.0.1{.fcm.googleapis.com/x',
      'https://127.0.0.1}.fcm.googleapis.com/x',
      'https://127.0.0.1".fcm.googleapis.com/x',
      "https://127.0.0.1'.fcm.googleapis.com/x",
      'https://127.0.0.1`.fcm.googleapis.com/x',
      'https://127.0.0.1\\.fcm.googleapis.com/x',
      'https://127.0.0.1^.fcm.googleapis.com/x',
      'https://127.0.0.1|.fcm.googleapis.com/x',
      'https://127.0.0.1<.fcm.googleapis.com/x',
      'https://127.0.0.1,.fcm.googleapis.com/x',
      'https://127.0.0.1!.fcm.googleapis.com/x',
      'https://127.0.0.1$.fcm.googleapis.com/x',
      'https://127.0.0.1&.fcm.googleapis.com/x',
      'https://127.0.0.1(.fcm.googleapis.com/x',
      'https://127.0.0.1*.fcm.googleapis.com/x',
      'https://127.0.0.1+.fcm.googleapis.com/x',
      'https://127.0.0.1=.fcm.googleapis.com/x',
      'https://127.0.0.1%2e.fcm.googleapis.com/x',
      'https://127.0.0.1 .fcm.googleapis.com/x',
      'https://127.0.0.1\t.fcm.googleapis.com/x',
      'https://evil.com\\@fcm.googleapis.com/x',
      'https://evil.com#@fcm.googleapis.com/x',
      'https://evil.com?@fcm.googleapis.com/x',
      'https:\\\\fcm.googleapis.com/x',
      'https:/fcm.googleapis.com/x',
      'https://fcm.googleapis.com./x',
      'https://xn--fcm-.googleapis.com/x',
      'https://ＦＣＭ.googleapis.com/x',
    ]) {
      expect(isAllowedPushEndpoint(ep), ep).toBe(false);
    }
  });
});
