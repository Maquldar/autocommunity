import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AdminWarningPayload } from '@autoc/shared';
import { SessionService } from '../../common/auth/session.service';
import { UserStateService } from '../../common/auth/user-state.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Cancel reasons the system writes; never counted as the user's own cancellations (antifraud). */
export const SYSTEM_CANCEL_PREFIX = 'system:';

/** Extra writes (e.g. the admin audit row) committed in the same transaction as the sanction. */
export type InTx = (tx: Prisma.TransactionClient) => Promise<unknown>;

/** Cancels one open SOS as the platform (registered by SosService, which depends on this module). */
export type SosCanceller = (requesterId: string, sosId: string, reason: string) => Promise<unknown>;

export type BlockOptions = { until: Date | null; note: string | null; automatic: boolean; inTx?: InTx };

/**
 * Account-level sanctions shared by the admin panel and antifraud: block (sessions revoked, sockets
 * disconnected, open SOS cancelled), unblock, SOS ban / unban, each with an `admin_warning` notification.
 */
@Injectable()
export class SanctionsService {
  private readonly logger = new Logger(SanctionsService.name);
  private sosCanceller: SosCanceller | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly userState: UserStateService,
    private readonly notifications: NotificationsService,
  ) {}

  registerSosCanceller(fn: SosCanceller): void {
    this.sosCanceller = fn;
  }

  async block(userId: string, opts: BlockOptions): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status: 'blocked', blockedUntil: opts.until } });
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await opts.inTx?.(tx);
    });
    // Redis state after commit: the next request (and socket handshake) sees the block.
    await this.userState.invalidate(userId);
    await this.sessions.markRevoked(userId);
    await this.cancelOpenSos(userId, opts.automatic ? 'auto_blocked' : 'admin_blocked');
    await this.notify(userId, { kind: 'blocked', note: opts.note, until: opts.until?.toISOString() ?? null, automatic: opts.automatic });
  }

  async unblock(userId: string, inTx?: InTx): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status: 'active', blockedUntil: null } });
      await inTx?.(tx);
    });
    await this.userState.invalidate(userId);
  }

  async sosBan(userId: string, until: Date, note: string | null, automatic: boolean, inTx?: InTx): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { sosBannedUntil: until } });
      await inTx?.(tx);
    });
    await this.notify(userId, { kind: 'sos_ban', note, until: until.toISOString(), automatic });
  }

  async sosUnban(userId: string, inTx?: InTx): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { sosBannedUntil: null } });
      await inTx?.(tx);
    });
  }

  /** Cancels every open SOS of the user through the normal transition (helpers notified, chat message). */
  async cancelOpenSos(userId: string, reason: string): Promise<string[]> {
    const open = await this.prisma.sosRequest.findMany({
      where: { userId, status: { in: ['created', 'accepted', 'in_progress'] } },
      select: { id: true },
    });
    if (!this.sosCanceller) throw new Error('SosService has not registered its canceller');
    for (const s of open) {
      try {
        await this.sosCanceller(userId, s.id, reason);
      } catch (err) {
        this.logger.warn({ err, sosId: s.id }, 'Cancelling an open SOS failed');
      }
    }
    return open.map((s) => s.id);
  }

  notify(userId: string, payload: AdminWarningPayload): Promise<unknown> {
    return this.notifications.create(userId, 'admin_warning', payload as unknown as Record<string, unknown>);
  }
}
