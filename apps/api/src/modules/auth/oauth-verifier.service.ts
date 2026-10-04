import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuthProviders } from '@autoc/shared';
import { OAuth2Client } from 'google-auth-library';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ENV, isDevOtpExposed, type Env } from '../../config/env';
import { Errors } from '../../common/errors/api-exception';

export type OAuthProfile = { uid: string; email: string | null; name: string | null };

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys');

const providerDisabled = (name: string) => Errors.notFound(`${name} sign-in is not enabled`, 'PROVIDER_DISABLED');
const invalidToken = () => Errors.unauthorized('Identity token is invalid or expired', 'INVALID_ID_TOKEN');

/** Verifies Google / Apple ID tokens. Each provider is enabled only when its client id is configured. */
@Injectable()
export class OAuthVerifierService {
  private readonly logger = new Logger(OAuthVerifierService.name);
  private googleClient: OAuth2Client | null = null;
  private appleJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {}

  providers(): AuthProviders {
    const { GOOGLE_CLIENT_ID, APPLE_CLIENT_ID, APPLE_REDIRECT_URI } = this.env;
    return {
      google: GOOGLE_CLIENT_ID ? { clientId: GOOGLE_CLIENT_ID } : null,
      apple: APPLE_CLIENT_ID && APPLE_REDIRECT_URI ? { clientId: APPLE_CLIENT_ID, redirectUri: APPLE_REDIRECT_URI } : null,
      devOtp: isDevOtpExposed(this.env),
    };
  }

  async verifyGoogle(idToken: string): Promise<OAuthProfile> {
    const clientId = this.env.GOOGLE_CLIENT_ID;
    if (!clientId) throw providerDisabled('Google');
    this.googleClient ??= new OAuth2Client(clientId);
    try {
      const ticket = await this.googleClient.verifyIdToken({ idToken, audience: clientId });
      const p = ticket.getPayload();
      if (!p?.sub) throw invalidToken();
      return { uid: p.sub, email: p.email_verified ? (p.email ?? null) : null, name: p.name ?? null };
    } catch (err) {
      this.logger.debug({ err }, 'Google token rejected');
      throw invalidToken();
    }
  }

  async verifyApple(idToken: string): Promise<OAuthProfile> {
    const clientId = this.env.APPLE_CLIENT_ID;
    if (!clientId) throw providerDisabled('Apple');
    this.appleJwks ??= createRemoteJWKSet(APPLE_JWKS_URL);
    try {
      const { payload } = await jwtVerify(idToken, this.appleJwks, { issuer: APPLE_ISSUER, audience: clientId });
      if (typeof payload.sub !== 'string') throw invalidToken();
      const email = typeof payload.email === 'string' ? payload.email : null;
      // Apple sends the user's name only to the client, on first sign-in; the client forwards it in the body.
      return { uid: payload.sub, email, name: null };
    } catch (err) {
      this.logger.debug({ err }, 'Apple token rejected');
      throw invalidToken();
    }
  }
}
