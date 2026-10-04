import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OAuthVerifierService } from './oauth-verifier.service';
import { OtpService } from './otp.service';
import { PhoneLinkController } from './phone-link.controller';
import { RefreshTokenService } from './refresh-token.service';

@Module({
  imports: [UsersModule],
  controllers: [AuthController, PhoneLinkController],
  providers: [AuthService, OtpService, RefreshTokenService, OAuthVerifierService],
})
export class AuthModule {}
