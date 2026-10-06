import { Injectable } from '@nestjs/common';
import {
  type AdminViolationDto,
  type AdminVoteDto,
  type AdminWalletDto,
  type AdminWalletTransactionDto,
  type Paginated,
  type VoteReason,
  type VoteValue,
  type WalletAdminPayload,
  type WalletTxKind,
} from '@autoc/shared';
import type { ViolationStatus } from '@prisma/client';
import { Errors } from '../../common/errors/api-exception';
import { decodeCursor, keysetOrderBy, keysetWhere, splitPage } from '../../common/pagination/cursor';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ViolationsService, type AdminDecision } from '../violations/violations.service';
import { VotesService } from '../votes/votes.service';
import { ensureWallets, insufficientFunds, lockWallets, post, premiumDto, sentLast24h } from '../wallet/wallet-ledger';
import { WalletService } from '../wallet/wallet.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminViewService } from './admin-view.service';

/** Phase 9 admin API (API.md §9): wallets, votes, violations. Every write is audited with the admin's note. */
@Injectable()
export class AdminPhase9Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly view: AdminViewService,
    private readonly audit: AdminAuditService,
    private readonly notifications: NotificationsService,
    private readonly wallets: WalletService,
    private readonly votes: VotesService,
    private readonly violations: ViolationsService,
  ) {}

  /* ------------------------------------------------------------------ wallets */

  async wallet(userId: string, now = new Date()): Promise<AdminWalletDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw Errors.notFound('User not found');
    await ensureWallets(this.prisma, [userId]);
    const [w, sub, sent] = await Promise.all([
      this.prisma.wallet.findUniqueOrThrow({ where: { userId } }),
      this.prisma.premiumSubscription.findFirst({ where: { userId, endedAt: null } }),
      sentLast24h(this.prisma, userId, now),
    ]);
    return { userId, balance: Number(w.balance), frozen: w.frozen, frozenAt: w.frozenAt?.toISOString() ?? null, premium: premiumDto(sub, now), sentLast24h: sent };
  }

  async transactions(userId: string, q: { cursor?: string; limit: number; kind?: WalletTxKind }): Promise<Paginated<AdminWalletTransactionDto>> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw Errors.notFound('User not found');
    const rows = await this.prisma.walletTransaction.findMany({
      where: { userId, ...(q.kind ? { kind: q.kind } : {}), ...keysetWhere(decodeCursor(q.cursor)) },
      orderBy: keysetOrderBy,
      take: q.limit + 1,
    });
    const page = splitPage(rows, q.limit);
    const dtos = await this.wallets.txDtos(page.rows);
    return { items: dtos.map((d, i) => ({ ...d, idempotencyKey: page.rows[i]!.idempotencyKey })), nextCursor: page.nextCursor };
  }

  /** +/− coins; never below 0 (checked under the wallet lock). Allowed on frozen wallets. */
  async adjust(adminId: string, userId: string, amount: number, note: string): Promise<AdminWalletDto> {
    await this.view.targetUser(adminId, userId);
    const balance = await this.prisma.$transaction(async (tx) => {
      const w = (await lockWallets(tx, [userId])).get(userId)!;
      if (w.balance + BigInt(amount) < 0n) throw insufficientFunds(w.balance);
      const row = await post(tx, { userId, kind: 'admin_adjust', amount, note });
      await this.audit.record({ adminId, action: 'wallet.adjust', targetType: 'wallet', targetId: userId, targetUserId: userId, note }, tx);
      return Number(row.balanceAfter);
    });
    await this.notifyWallet(userId, { action: 'adjust', amount, balance, note });
    return this.wallet(userId);
  }

  async setFrozen(adminId: string, userId: string, frozen: boolean, note: string): Promise<AdminWalletDto> {
    await this.view.targetUser(adminId, userId);
    const balance = await this.prisma.$transaction(async (tx) => {
      const w = (await lockWallets(tx, [userId])).get(userId)!;
      if (frozen && w.frozen) throw Errors.conflict('WALLET_ALREADY_FROZEN', 'The wallet is already frozen');
      if (!frozen && !w.frozen) throw Errors.conflict('WALLET_NOT_FROZEN', 'The wallet is not frozen');
      await tx.wallet.update({ where: { userId }, data: { frozen, frozenAt: frozen ? new Date() : null } });
      await this.audit.record({ adminId, action: frozen ? 'wallet.freeze' : 'wallet.unfreeze', targetType: 'wallet', targetId: userId, targetUserId: userId, note }, tx);
      return Number(w.balance);
    });
    await this.notifyWallet(userId, { action: frozen ? 'freeze' : 'unfreeze', amount: null, balance, note });
    return this.wallet(userId);
  }

  private async notifyWallet(userId: string, payload: WalletAdminPayload): Promise<void> {
    await this.notifications.create(userId, 'wallet_admin', payload);
  }

  /* ------------------------------------------------------------------ votes */

  async votesFor(userId: string, q: { cursor?: string; limit: number; value?: number }): Promise<Paginated<AdminVoteDto>> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw Errors.notFound('User not found');
    const rows = await this.prisma.userVote.findMany({
      where: { targetId: userId, ...(q.value ? { value: q.value } : {}), ...keysetWhere(decodeCursor(q.cursor)) },
      orderBy: keysetOrderBy,
      take: q.limit + 1,
    });
    const page = splitPage(rows, q.limit);
    const minis = await this.view.minis(page.rows.flatMap((r) => [r.voterId, r.targetId]));
    const mini = (id: string) => minis.get(id) ?? { id, nickname: '', name: 'Deleted user', avatarUrl: null, rating: 0, isPremium: false };
    return {
      items: page.rows.map((r) => ({
        id: r.id,
        voter: mini(r.voterId),
        target: mini(r.targetId),
        value: r.value as VoteValue,
        reason: r.reason as VoteReason,
        comment: r.comment,
        weight: r.weight,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  async removeVote(adminId: string, voteId: string, note: string): Promise<void> {
    const vote = await this.prisma.userVote.findUnique({ where: { id: voteId }, select: { targetId: true } });
    if (!vote) throw Errors.notFound('Vote not found');
    await this.view.targetUser(adminId, vote.targetId);
    await this.prisma.$transaction(async (tx) => {
      const removed = await this.votes.removeTx(tx, voteId);
      await this.audit.record({ adminId, action: 'vote.remove', targetType: 'vote', targetId: voteId, targetUserId: removed.targetId, note }, tx);
    });
  }

  /* ------------------------------------------------------------------ violations */

  violationsList(q: { cursor?: string; limit: number; status?: ViolationStatus }): Promise<Paginated<AdminViolationDto>> {
    return this.violations.adminList(q);
  }

  decideViolation(adminId: string, id: string, decision: AdminDecision, note: string): Promise<AdminViolationDto> {
    const action = (
      { approve: 'violation.approve', reject: 'violation.reject', uphold: 'violation.uphold', remove: 'violation.remove' } as const
    )[decision];
    return this.violations.decide(adminId, id, decision, note, (tx, v) =>
      this.audit.record({ adminId, action, targetType: 'violation', targetId: v.id, targetUserId: v.ownerId, note }, tx),
    );
  }
}
