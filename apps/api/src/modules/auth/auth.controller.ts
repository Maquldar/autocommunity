import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import {
  appleAuthSchema,
  googleAuthSchema,
  otpRequestSchema,
  otpVerifySchema,
  type AuthProviders,
  type AuthResult,
  type OtpRequestResult,
} from '@autoc/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../../common/auth/decorators';
import { Errors } from '../../common/errors/api-exception';
import { AuthCookies } from '../../common/http/auth-cookies';
import { clientMeta } from '../../common/http/client-meta';
import { ZBody } from '../../common/validation/zod.pipe';
import { AuthService, type Session } from './auth.service';
import { OAuthVerifierService } from './oauth-verifier.service';
import { OtpService } from './otp.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly otp: OtpService,
    private readonly oauth: OAuthVerifierService,
    private readonly cookies: AuthCookies,
  ) {}

  @Public()
  @Get('providers')
  providers(): AuthProviders {
    return this.oauth.providers();
  }

  @Public()
  @Post('otp/request')
  @HttpCode(200)
  requestOtp(@Req() req: Request, @ZBody(otpRequestSchema) body: z.output<typeof otpRequestSchema>): Promise<OtpRequestResult> {
    return this.otp.request(body.phone, clientMeta(req).ip ?? 'unknown');
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @ZBody(otpVerifySchema) body: z.output<typeof otpVerifySchema>,
  ): Promise<AuthResult> {
    await this.otp.verify(body.phone, body.code);
    return this.respond(res, await this.auth.loginWithPhone(body.phone, clientMeta(req)));
  }

  @Public()
  @Post('google')
  @HttpCode(200)
  async google(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @ZBody(googleAuthSchema) body: z.output<typeof googleAuthSchema>,
  ): Promise<AuthResult> {
    const profile = await this.oauth.verifyGoogle(body.idToken);
    return this.respond(res, await this.auth.loginWithOAuth('google', profile, clientMeta(req)));
  }

  @Public()
  @Post('apple')
  @HttpCode(200)
  async apple(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @ZBody(appleAuthSchema) body: z.output<typeof appleAuthSchema>,
  ): Promise<AuthResult> {
    const profile = await this.oauth.verifyApple(body.idToken);
    const session = await this.auth.loginWithOAuth('apple', { ...profile, name: body.name ?? null }, clientMeta(req));
    return this.respond(res, session);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ accessToken: string }> {
    this.cookies.assertCsrf(req);
    const token = this.cookies.readRefresh(req);
    if (!token) throw Errors.unauthorized('Session expired, sign in again', 'SESSION_EXPIRED');
    try {
      const result = await this.auth.refresh(token, clientMeta(req));
      this.cookies.set(res, result.refreshToken, this.cookies.readCsrf(req)!);
      return { accessToken: result.accessToken };
    } catch (err) {
      this.cookies.clear(res);
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    this.cookies.assertCsrf(req);
    await this.auth.logout(this.cookies.readRefresh(req));
    this.cookies.clear(res);
  }

  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logoutAll(user.id);
    this.cookies.clear(res);
  }

  private respond(res: Response, session: Session): AuthResult {
    this.cookies.set(res, session.refreshToken, session.csrfToken);
    return { accessToken: session.accessToken, user: session.user, isNew: session.isNew };
  }
}
