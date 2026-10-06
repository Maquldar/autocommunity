import { Controller, Get, HttpCode, Post, Put, Res, UseGuards } from '@nestjs/common';
import {
  adminNoteBodySchema,
  adminPayPartnerSchema,
  createPayOrderSchema,
  payOrdersQuerySchema,
  payTagParamSchema,
  putPayItemsSchema,
  type AdminNoteInput,
  type AdminPayPartnerInput,
  type CreatePayOrderInput,
  type Paginated,
  type PayPointDto,
  type PayPointManageDto,
  type PayReceiptDto,
  type PutPayItemsInput,
} from '@autoc/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/decorators';
import { IdParam, ZBody, ZParam, ZQuery } from '../../common/validation/zod.pipe';
import { AdminRateLimitGuard } from '../admin/admin-rate-limit.guard';
import { PayService } from './pay.service';

/** API.md §10 — "Оплата на точке". */
@Controller('pay')
export class PayController {
  constructor(private readonly pay: PayService) {}

  @Get('points/:id')
  point(@IdParam() id: string): Promise<PayPointDto> {
    return this.pay.point(id);
  }

  @Get('t/:tag')
  byTag(@CurrentUser() user: AuthUser, @ZParam('tag', payTagParamSchema) tag: string): Promise<PayPointDto> {
    return this.pay.pointByTag(user.id, tag);
  }

  @Get('points/:id/manage')
  manage(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<PayPointManageDto> {
    return this.pay.manage(user, id);
  }

  @Put('points/:id/items')
  putItems(@CurrentUser() user: AuthUser, @IdParam() id: string, @ZBody(putPayItemsSchema) body: PutPayItemsInput): Promise<PayPointManageDto> {
    return this.pay.putItems(user, id, body);
  }

  /** 201 for a new order, 200 for a replay of the same idempotency key. */
  @Post('orders')
  async create(@CurrentUser() user: AuthUser, @ZBody(createPayOrderSchema) body: CreatePayOrderInput, @Res({ passthrough: true }) res: Response): Promise<PayReceiptDto> {
    const { receipt, replay } = await this.pay.createOrder(user.id, body);
    res.status(replay ? 200 : 201);
    return receipt;
  }

  @Get('orders')
  orders(@CurrentUser() user: AuthUser, @ZQuery(payOrdersQuerySchema) q: z.output<typeof payOrdersQuerySchema>): Promise<Paginated<PayReceiptDto>> {
    return this.pay.orders(user.id, q);
  }

  @Get('orders/:id')
  order(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<PayReceiptDto> {
    return this.pay.order(user.id, id);
  }
}

/** API.md §10 admin routes — role=admin, rate limited like the rest of /admin, audited with a note. */
@Controller('admin/services')
@Roles('admin')
@UseGuards(AdminRateLimitGuard)
export class AdminPayController {
  constructor(private readonly pay: PayService) {}

  @Put(':id/partner')
  partner(@CurrentUser() admin: AuthUser, @IdParam() id: string, @ZBody(adminPayPartnerSchema) body: AdminPayPartnerInput): Promise<PayPointManageDto> {
    return this.pay.setPartner(admin, id, body);
  }

  @Post(':id/pay-tag/rotate')
  @HttpCode(200)
  rotate(@CurrentUser() admin: AuthUser, @IdParam() id: string, @ZBody(adminNoteBodySchema) body: AdminNoteInput): Promise<PayPointManageDto> {
    return this.pay.rotateTag(admin, id, body.note);
  }
}
