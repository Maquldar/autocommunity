import { describe, expect, it, vi } from 'vitest';
import { ApiException } from '../../common/errors/api-exception';
import { TwilioSmsSender } from './twilio-sms.sender';

describe('TwilioSmsSender', () => {
  it('posts a form-encoded message with basic auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    const sender = new TwilioSmsSender({ accountSid: 'AC123', authToken: 'tok', from: '+15550001111' }, fetchMock);
    await sender.send('+77011234567', 'hello');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('AC123:tok').toString('base64')}`);
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({ To: '+77011234567', Body: 'hello', From: '+15550001111' });
  });

  it('uses MessagingServiceSid for MG senders and maps failures to SMS_UNAVAILABLE', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad', { status: 400 }));
    const sender = new TwilioSmsSender({ accountSid: 'AC1', authToken: 't', from: 'MG42' }, fetchMock);
    await expect(sender.send('+77011234567', 'x')).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiException && e.code === 'SMS_UNAVAILABLE',
    );
    expect((fetchMock.mock.calls[0]![1].body as URLSearchParams).get('MessagingServiceSid')).toBe('MG42');
  });
});
