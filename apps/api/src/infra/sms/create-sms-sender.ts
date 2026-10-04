import type { Env } from '../../config/env';
import { ConsoleSmsSender } from './console-sms.sender';
import type { SmsSender } from './sms-sender';
import { TwilioSmsSender } from './twilio-sms.sender';

export function createSmsSender(env: Env): SmsSender {
  if (env.SMS_PROVIDER === 'twilio') {
    return new TwilioSmsSender({
      accountSid: env.TWILIO_ACCOUNT_SID!,
      authToken: env.TWILIO_AUTH_TOKEN!,
      from: env.TWILIO_FROM!,
    });
  }
  return new ConsoleSmsSender();
}
