import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthCookies } from '../http/auth-cookies';
import { AccessTokenService } from './access-token.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { SessionService } from './session.service';
import { UserStateService } from './user-state.service';

/** Request authentication shared by every module: access tokens, account state cache, global guards. */
@Global()
@Module({
  providers: [
    AccessTokenService,
    UserStateService,
    SessionService,
    AuthCookies,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AccessTokenService, UserStateService, SessionService, AuthCookies],
})
export class AuthCoreModule {}
