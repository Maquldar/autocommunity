import { Injectable } from '@nestjs/common';
import { Errors } from '../../common/errors/api-exception';
import { newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { isAllowedPushEndpoint } from './push-endpoint';

/** Oldest subscriptions beyond this are dropped (a user rarely has more browsers/devices). */
export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 10;

@Injectable()
export class PushService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upsert by endpoint. An endpoint identifies one browser profile, so if another account registered it
   * before (shared device, re-login), it now belongs to the caller.
   */
  async subscribe(userId: string, input: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<void> {
    if (!isAllowedPushEndpoint(input.endpoint)) {
      throw Errors.badRequest('INVALID_PUSH_ENDPOINT', 'Push endpoint must be a browser push service URL');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.pushSubscription.upsert({
        where: { endpoint: input.endpoint },
        create: { id: newId(), userId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth },
        update: { userId, p256dh: input.keys.p256dh, auth: input.keys.auth },
      });
      const stale = await tx.pushSubscription.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: MAX_PUSH_SUBSCRIPTIONS_PER_USER,
        select: { id: true },
      });
      if (stale.length) await tx.pushSubscription.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
    });
  }

  /** Idempotent; only removes the caller's own subscription. */
  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });
  }
}
