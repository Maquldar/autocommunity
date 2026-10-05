import { Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { pushSubscriptionSchema, pushUnsubscribeSchema } from '@autoc/shared';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/auth/decorators';
import { ZBody } from '../../common/validation/zod.pipe';
import { PushService } from './push.service';
import { VapidService } from './vapid.service';

@Controller('push')
export class PushController {
  constructor(
    private readonly push: PushService,
    private readonly vapid: VapidService,
  ) {}

  @Get('vapid-public-key')
  async publicKey(): Promise<{ key: string | null }> {
    return { key: (await this.vapid.getKeys())?.publicKey ?? null };
  }

  @Post('subscriptions')
  @HttpCode(204)
  subscribe(@CurrentUser() user: AuthUser, @ZBody(pushSubscriptionSchema) body: z.output<typeof pushSubscriptionSchema>): Promise<void> {
    return this.push.subscribe(user.id, body);
  }

  @Delete('subscriptions')
  @HttpCode(204)
  unsubscribe(@CurrentUser() user: AuthUser, @ZBody(pushUnsubscribeSchema) body: z.output<typeof pushUnsubscribeSchema>): Promise<void> {
    return this.push.unsubscribe(user.id, body.endpoint);
  }
}
