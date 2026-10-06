import { Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import {
  createTopupSchema,
  createTransferSchema,
  demoConfirmTopupSchema,
  walletTransactionsQuerySchema,
  type CreateTopupInput,
  type CreateTopupResult,
  type CreateTransferInput,
  type DemoConfirmTopupInput,
  type Paginated,
  type PremiumDto,
  type TopupDto,
  type TransferResult,
  type WalletDto,
  type WalletTransactionDto,
} from '@autoc/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/auth/decorators';
import { IdParam, ZBody, ZQuery } from '../../common/validation/zod.pipe';
import { PremiumService } from './premium.service';
import { WalletService } from './wallet.service';

/** API.md §9.1 */
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  get(@CurrentUser() user: AuthUser): Promise<WalletDto> {
    return this.wallet.get(user.id);
  }

  @Get('transactions')
  transactions(@CurrentUser() user: AuthUser, @ZQuery(walletTransactionsQuerySchema) q: z.output<typeof walletTransactionsQuerySchema>): Promise<Paginated<WalletTransactionDto>> {
    return this.wallet.transactions(user.id, q);
  }

  @Post('topups')
  createTopup(@CurrentUser() user: AuthUser, @ZBody(createTopupSchema) body: CreateTopupInput): Promise<CreateTopupResult> {
    return this.wallet.createTopup(user.id, body.amount);
  }

  @Get('topups/:id')
  getTopup(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<TopupDto> {
    return this.wallet.getTopup(user.id, id);
  }

  @Post('topups/:id/demo-confirm')
  @HttpCode(200)
  demoConfirm(@CurrentUser() user: AuthUser, @IdParam() id: string, @ZBody(demoConfirmTopupSchema) body: DemoConfirmTopupInput): Promise<TopupDto> {
    return this.wallet.demoConfirm(user.id, id, body);
  }

  /** 201 for a new transfer, 200 for a replay of the same idempotency key. */
  @Post('transfers')
  async transfer(@CurrentUser() user: AuthUser, @ZBody(createTransferSchema) body: CreateTransferInput, @Res({ passthrough: true }) res: Response): Promise<TransferResult> {
    const { replay, ...result } = await this.wallet.transfer(user.id, body);
    res.status(replay ? 200 : 201);
    return result;
  }
}

/** API.md §9.2 */
@Controller('premium')
export class PremiumController {
  constructor(private readonly premium: PremiumService) {}

  @Get()
  get(@CurrentUser() user: AuthUser): Promise<PremiumDto> {
    return this.premium.get(user.id);
  }

  @Post('subscribe')
  @HttpCode(200)
  subscribe(@CurrentUser() user: AuthUser): Promise<PremiumDto> {
    return this.premium.subscribe(user.id);
  }

  @Post('cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser): Promise<PremiumDto> {
    return this.premium.cancel(user.id);
  }

  @Post('resume')
  @HttpCode(200)
  resume(@CurrentUser() user: AuthUser): Promise<PremiumDto> {
    return this.premium.resume(user.id);
  }
}
