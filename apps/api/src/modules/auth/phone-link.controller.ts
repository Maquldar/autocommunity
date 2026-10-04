import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import { otpRequestSchema, otpVerifySchema, type Me, type OtpRequestResult } from '@autoc/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/auth/decorators';
import { clientMeta } from '../../common/http/client-meta';
import { ZBody } from '../../common/validation/zod.pipe';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';

/** Linking a phone number to an account created via Google/Apple (or changing it). */
@Controller('me/phone')
export class PhoneLinkController {
  constructor(
    private readonly auth: AuthService,
    private readonly otp: OtpService,
  ) {}

  @Post('request')
  @HttpCode(200)
  async request(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @ZBody(otpRequestSchema) body: z.output<typeof otpRequestSchema>,
  ): Promise<OtpRequestResult> {
    await this.auth.assertPhoneAvailable(user.id, body.phone);
    return this.otp.request(body.phone, clientMeta(req).ip ?? 'unknown');
  }

  @Post('verify')
  @HttpCode(200)
  async verify(@CurrentUser() user: AuthUser, @ZBody(otpVerifySchema) body: z.output<typeof otpVerifySchema>): Promise<Me> {
    await this.auth.assertPhoneAvailable(user.id, body.phone);
    await this.otp.verify(body.phone, body.code);
    return this.auth.linkPhone(user.id, body.phone);
  }
}
