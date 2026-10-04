import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import { otpRequestSchema, otpVerifySchema, type Me, type OtpRequestResult } from '@autoc/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/auth/decorators';
import { clientMeta } from '../../common/http/client-meta';
import { ZBody } from '../../common/validation/zod.pipe';
import { AuthService } from './auth.service';

/** Linking a phone number to an account created via Google/Apple. */
@Controller('me/phone')
export class PhoneLinkController {
  constructor(private readonly auth: AuthService) {}

  @Post('request')
  @HttpCode(200)
  request(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @ZBody(otpRequestSchema) body: z.output<typeof otpRequestSchema>,
  ): Promise<OtpRequestResult> {
    return this.auth.requestPhoneLink(user.id, body.phone, clientMeta(req).ip ?? 'unknown');
  }

  @Post('verify')
  @HttpCode(200)
  verify(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @ZBody(otpVerifySchema) body: z.output<typeof otpVerifySchema>,
  ): Promise<Me> {
    return this.auth.linkPhone(user.id, body.phone, body.code, clientMeta(req).ip ?? 'unknown');
  }
}
