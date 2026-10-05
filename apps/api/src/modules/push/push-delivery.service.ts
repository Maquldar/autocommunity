import { Injectable, Logger } from '@nestjs/common';
import type { PushPayload } from '@autoc/shared';
import { UnrecoverableError } from 'bullmq';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { VapidService } from './vapid.service';
import { WebPushSender } from './web-push.sender';

export type DeliveryResult = 'sent' | 'gone' | 'skipped';

const statusOf = (err: unknown): number | undefined => {
  const code = (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof code === 'number' ? code : undefined;
};

/** Sends one push message to one subscription and applies the push service's verdict. */
@Injectable()
export class PushDeliveryService {
  private readonly logger = new Logger(PushDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vapid: VapidService,
    private readonly sender: WebPushSender,
  ) {}

  /**
   * - 404/410: the subscription expired or was revoked → deleted;
   * - 429, 5xx, network errors: thrown so the queue retries with backoff;
   * - other 4xx (bad payload/keys): `UnrecoverableError`, never retried.
   */
  async deliver(subscriptionId: string, payload: PushPayload): Promise<DeliveryResult> {
    const sub = await this.prisma.pushSubscription.findUnique({ where: { id: subscriptionId } });
    if (!sub) return 'skipped';
    const keys = await this.vapid.getKeys();
    if (!keys) throw new Error('VAPID keys unavailable');
    try {
      await this.sender.send(sub, JSON.stringify(payload), keys);
      return 'sent';
    } catch (err) {
      const status = statusOf(err);
      if (status === 404 || status === 410) {
        await this.prisma.pushSubscription.deleteMany({ where: { id: sub.id, endpoint: sub.endpoint } });
        return 'gone';
      }
      if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
        this.logger.warn({ status, subscriptionId }, 'Push rejected by the push service');
        throw new UnrecoverableError(`Push rejected with HTTP ${status}`);
      }
      throw err;
    }
  }
}
