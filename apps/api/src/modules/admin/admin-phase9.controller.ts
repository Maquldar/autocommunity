import { Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  adminNoteBodySchema,
  adminResolveDisputeSchema,
  adminViolationsQuerySchema,
  adminVotesQuerySchema,
  adminWalletAdjustSchema,
  walletTransactionsQuerySchema,
  type AdminNoteInput,
  type AdminResolveDisputeInput,
  type AdminViolationDto,
  type AdminVoteDto,
  type AdminWalletAdjustInput,
  type AdminWalletDto,
  type AdminWalletTransactionDto,
  type Paginated,
} from '@autoc/shared';
import type { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/decorators';
import { IdParam, ZBody, ZQuery } from '../../common/validation/zod.pipe';
import { AdminPhase9Service } from './admin-phase9.service';
import { AdminRateLimitGuard } from './admin-rate-limit.guard';

/** API.md §9 admin routes — role=admin, 300 requests/min per admin, writes audited with a note. */
@Controller('admin')
@Roles('admin')
@UseGuards(AdminRateLimitGuard)
export class AdminPhase9Controller {
  constructor(private readonly svc: AdminPhase9Service) {}

  /* wallets */

  @Get('users/:id/wallet')
  wallet(@IdParam() id: string): Promise<AdminWalletDto> {
    return this.svc.wallet(id);
  }

  @Get('users/:id/wallet/transactions')
  transactions(@IdParam() id: string, @ZQuery(walletTransactionsQuerySchema) q: z.output<typeof walletTransactionsQuerySchema>): Promise<Paginated<AdminWalletTransactionDto>> {
    return this.svc.transactions(id, q);
  }

  @Post('users/:id/wallet/adjust')
  @HttpCode(200)
  adjust(@CurrentUser() admin: AuthUser, @IdParam() id: string, @ZBody(adminWalletAdjustSchema) body: AdminWalletAdjustInput): Promise<AdminWalletDto> {
    return this.svc.adjust(admin.id, id, body.amount, body.note);
  }

  @Post('users/:id/wallet/freeze')
  @HttpCode(200)
  freeze(@CurrentUser() admin: AuthUser, @IdParam() id: string, @ZBody(adminNoteBodySchema) body: AdminNoteInput): Promise<AdminWalletDto> {
    return this.svc.setFrozen(admin.id, id, true, body.note);
  }

  @Post('users/:id/wallet/unfreeze')
  @HttpCode(200)
  unfreeze(@CurrentUser() admin: AuthUser, @IdParam() id: string, @ZBody(adminNoteBodySchema) body: AdminNoteInput): Promise<AdminWalletDto> {
    return this.svc.setFrozen(admin.id, id, false, body.note);
  }

  /* votes */

  @Get('users/:id/votes')
  votes(@IdParam() id: string, @ZQuery(adminVotesQuerySchema) q: z.output<typeof adminVotesQuerySchema>): Promise<Paginated<AdminVoteDto>> {
    return this.svc.votesFor(id, q);
  }

  @Delete('votes/:id')
  @HttpCode(204)
  async removeVote(@CurrentUser() admin: AuthUser, @IdParam() id: string, @ZBody(adminNoteBodySchema) body: AdminNoteInput): Promise<void> {
    await this.svc.removeVote(admin.id, id, body.note);
  }

  /* violations */

  @Get('violations')
  violations(@ZQuery(adminViolationsQuerySchema) q: z.output<typeof adminViolationsQuerySchema>): Promise<Paginated<AdminViolationDto>> {
    return this.svc.violationsList(q);
  }

  @Post('violations/:id/approve')
  @HttpCode(200)
  approve(@CurrentUser() admin: AuthUser, @IdParam() id: string, @ZBody(adminNoteBodySchema) body: AdminNoteInput): Promise<AdminViolationDto> {
    return this.svc.decideViolation(admin.id, id, 'approve', body.note);
  }

  @Post('violations/:id/reject')
  @HttpCode(200)
  reject(@CurrentUser() admin: AuthUser, @IdParam() id: string, @ZBody(adminNoteBodySchema) body: AdminNoteInput): Promise<AdminViolationDto> {
    return this.svc.decideViolation(admin.id, id, 'reject', body.note);
  }

  @Post('violations/:id/resolve-dispute')
  @HttpCode(200)
  resolve(@CurrentUser() admin: AuthUser, @IdParam() id: string, @ZBody(adminResolveDisputeSchema) body: AdminResolveDisputeInput): Promise<AdminViolationDto> {
    return this.svc.decideViolation(admin.id, id, body.decision, body.note);
  }
}
