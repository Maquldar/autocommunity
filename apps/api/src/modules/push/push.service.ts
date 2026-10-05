import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Errors } from '../../common/errors/api-exception';
import { newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { normalizePushEndpoint } from './push-endpoint';

/** Oldest subscriptions beyond this are dropped (a user rarely has more browsers/devices). */
export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 10;

@Injectable()
export class PushService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upsert by (normalized) endpoint for the caller. An endpoint registered by another account is refused
   * with 409 PUSH_ENDPOINT_IN_USE (its keys are never overwritten); the web client unsubscribes on sign-out.
   */
  async subscribe(userId: string, input: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<void> {
    const endpoint = normalizePushEndpoint(input.endpoint);
    if (!endpoint) throw Errors.badRequest('INVALID_PUSH_ENDPOINT', 'Push endpoint must be a browser push service URL');
    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.pushSubscription.findUnique({ where: { endpoint }, select: { userId: true } });
        if (existing && existing.userId !== userId) throw endpointInUse();
        await tx.pushSubscription.upsert({
          where: { endpoint },
          create: { id: newId(), userId, endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth },
          update: { p256dh: input.keys.p256dh, auth: input.keys.auth },
        });
        const stale = await tx.pushSubscription.findMany({
          where: { userId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: MAX_PUSH_SUBSCRIPTIONS_PER_USER,
          select: { id: true },
        });
        if (stale.length) await tx.pushSubscription.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
      });
    } catch (err) {
      // Concurrent first registration of the same endpoint by two accounts.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw endpointInUse();
      throw err;
    }
  }

  /** Idempotent; only removes the caller's own subscription. */
  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    const normalized = normalizePushEndpoint(endpoint) ?? endpoint;
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint: { in: [...new Set([endpoint, normalized])] }, userId } });
  }
}

const endpointInUse = () => Errors.conflict('PUSH_ENDPOINT_IN_USE', 'This push endpoint is registered to another account');
