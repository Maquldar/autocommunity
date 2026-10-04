import { Controller, Delete, Get, HttpCode, Patch, Post, Res } from '@nestjs/common';
import {
  deleteAccountSchema,
  updateMeSchema,
  updateSettingsSchema,
  type Me,
  type UpdateMeInput,
  type UpdateSettingsInput,
} from '@autoc/shared';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../../common/auth/decorators';
import { ZBody } from '../../common/validation/zod.pipe';
import { AuthCookies } from '../../common/http/auth-cookies';
import { UsersService } from './users.service';

@Controller('me')
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly cookies: AuthCookies,
  ) {}

  @Get()
  me(@CurrentUser() user: AuthUser): Promise<Me> {
    return this.users.getMe(user.id);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @ZBody(updateMeSchema) body: UpdateMeInput): Promise<Me> {
    return this.users.updateMe(user.id, body);
  }

  @Patch('settings')
  updateSettings(@CurrentUser() user: AuthUser, @ZBody(updateSettingsSchema) body: UpdateSettingsInput): Promise<Me> {
    return this.users.updateSettings(user.id, body);
  }

  @Post('onboarding/complete')
  @HttpCode(200)
  completeOnboarding(@CurrentUser() user: AuthUser): Promise<Me> {
    return this.users.completeOnboarding(user.id);
  }

  @Delete()
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @ZBody(deleteAccountSchema) _body: { confirm: 'DELETE' },
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.users.deleteAccount(user.id);
    this.cookies.clear(res);
  }
}
