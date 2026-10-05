import { WebPushError } from 'web-push';
import type { PushTarget } from '../../src/modules/push/web-push.sender';
import type { VapidKeys } from '../../src/modules/push/vapid.service';

export type SentPush = { endpoint: string; payload: Record<string, unknown>; vapidPublicKey: string };

/**
 * Replaces WebPushSender at the protocol boundary. `respond` decides each send's outcome by endpoint:
 * return a status code ≥ 400 to fail like the push service would, or undefined/201 to succeed.
 */
export class FakePushSender {
  readonly sent: SentPush[] = [];
  readonly attempts: string[] = [];
  respond: (endpoint: string) => number | undefined = () => undefined;

  async send(target: PushTarget, body: string, vapid: VapidKeys): Promise<void> {
    this.attempts.push(target.endpoint);
    const status = this.respond(target.endpoint);
    if (status !== undefined && status >= 400) {
      throw new WebPushError('Received unexpected response code', status, {}, '', target.endpoint);
    }
    this.sent.push({ endpoint: target.endpoint, payload: JSON.parse(body) as Record<string, unknown>, vapidPublicKey: vapid.publicKey });
  }

  reset(): void {
    this.sent.length = 0;
    this.attempts.length = 0;
    this.respond = () => undefined;
  }
}
