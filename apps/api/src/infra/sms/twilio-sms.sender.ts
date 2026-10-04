import { Logger } from '@nestjs/common';
import { maskPhone } from '@autoc/shared';
import { Errors } from '../../common/errors/api-exception';
import { SmsSender } from './sms-sender';

export type TwilioConfig = { accountSid: string; authToken: string; from: string };

/** Twilio Programmable Messaging REST API (no SDK dependency). */
export class TwilioSmsSender extends SmsSender {
  private readonly logger = new Logger('SMS');

  constructor(
    private readonly config: TwilioConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    super();
  }

  async send(to: string, text: string): Promise<void> {
    const { accountSid, authToken, from } = this.config;
    const body = new URLSearchParams({ To: to, Body: text });
    // A Messaging Service SID lets Twilio pick the sender (alphanumeric IDs, number pools).
    if (from.startsWith('MG')) body.set('MessagingServiceSid', from);
    else body.set('From', from);

    let res: Response;
    try {
      res = await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      this.logger.error({ err, to: maskPhone(to) }, 'Twilio request failed');
      throw Errors.unavailable('SMS_UNAVAILABLE', 'Could not send SMS, try again later');
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.logger.error({ status: res.status, detail: detail.slice(0, 500), to: maskPhone(to) }, 'Twilio rejected SMS');
      throw Errors.unavailable('SMS_UNAVAILABLE', 'Could not send SMS, try again later');
    }
  }
}
