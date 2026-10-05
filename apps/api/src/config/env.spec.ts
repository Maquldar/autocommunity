import { describe, expect, it } from 'vitest';
import { isDevOtpExposed, parseEnvOrThrow } from './env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  OTP_SECRET: 'b'.repeat(32),
  PUBLIC_MEDIA_URL: 'http://localhost:4000/media/',
};

describe('env validation', () => {
  it('applies defaults and normalizes values', () => {
    const env = parseEnvOrThrow({ ...base, WEB_ORIGIN: 'http://a.test, http://b.test', COOKIE_DOMAIN: '' });
    expect(env.API_PORT).toBe(4000);
    expect(env.WEB_ORIGIN).toEqual(['http://a.test', 'http://b.test']);
    expect(env.PUBLIC_MEDIA_URL).toBe('http://localhost:4000/media');
    expect(env.COOKIE_DOMAIN).toBeUndefined();
    expect(env.SMS_PROVIDER).toBe('console');
    expect(env.TRUST_PROXY).toBe('false');
    expect(env.OTP_ALLOWED_PREFIXES).toEqual(['+7']);
    expect(parseEnvOrThrow({ ...base, OTP_ALLOWED_PREFIXES: '+7, +998' }).OTP_ALLOWED_PREFIXES).toEqual(['+7', '+998']);
    expect(() => parseEnvOrThrow({ ...base, OTP_ALLOWED_PREFIXES: '7' })).toThrow(/OTP_ALLOWED_PREFIXES/);
  });

  it('refuses the console SMS sender in production unless explicitly allowed', () => {
    expect(() => parseEnvOrThrow({ ...base, NODE_ENV: 'production' })).toThrow(/ALLOW_CONSOLE_SMS/);
    expect(parseEnvOrThrow({ ...base, NODE_ENV: 'production', ALLOW_CONSOLE_SMS: 'true' }).SMS_PROVIDER).toBe('console');
  });

  it('supports demo hosting: PORT, bare-host origins, derived media URL and DEMO_MODE', () => {
    const { PUBLIC_MEDIA_URL: _omit, ...noMedia } = base;
    const env = parseEnvOrThrow({ ...noMedia, PORT: '10000', WEB_ORIGIN: 'autoc-web.onrender.com', NODE_ENV: 'production', DEMO_MODE: 'true' });
    expect(env.API_PORT).toBe(10000);
    expect(env.WEB_ORIGIN).toEqual(['https://autoc-web.onrender.com']);
    expect(env.PUBLIC_MEDIA_URL).toBe('https://autoc-web.onrender.com/media');
    expect(isDevOtpExposed(env)).toBe(true);
    // An explicit API_PORT wins over PORT.
    expect(parseEnvOrThrow({ ...base, PORT: '10000', API_PORT: '4001' }).API_PORT).toBe(4001);
    // Without DEMO_MODE production still refuses console SMS and exposed codes.
    expect(() => parseEnvOrThrow({ ...base, NODE_ENV: 'production', AUTH_EXPOSE_DEV_CODE: 'true', ALLOW_CONSOLE_SMS: 'true' })).toThrow(
      /AUTH_EXPOSE_DEV_CODE/,
    );
  });

  it('fails fast listing every problem', () => {
    expect(() => parseEnvOrThrow({ JWT_ACCESS_SECRET: 'short' })).toThrow(/DATABASE_URL[\s\S]*JWT_ACCESS_SECRET/);
  });

  it('requires provider credentials for the selected drivers', () => {
    expect(() => parseEnvOrThrow({ ...base, SMS_PROVIDER: 'twilio' })).toThrow(/TWILIO_ACCOUNT_SID/);
    expect(() => parseEnvOrThrow({ ...base, STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/);
    expect(() => parseEnvOrThrow({ ...base, APPLE_CLIENT_ID: 'com.example.web' })).toThrow(/APPLE_REDIRECT_URI/);
  });

  it('never exposes dev OTP codes in production or with a real SMS provider', () => {
    expect(() =>
      parseEnvOrThrow({ ...base, NODE_ENV: 'production', ALLOW_CONSOLE_SMS: 'true', AUTH_EXPOSE_DEV_CODE: 'true' }),
    ).toThrow(/AUTH_EXPOSE_DEV_CODE/);
    const twilio = parseEnvOrThrow({
      ...base,
      SMS_PROVIDER: 'twilio',
      TWILIO_ACCOUNT_SID: 'AC1',
      TWILIO_AUTH_TOKEN: 't',
      TWILIO_FROM: '+15550001111',
      AUTH_EXPOSE_DEV_CODE: 'true',
    });
    expect(isDevOtpExposed(twilio)).toBe(false);
    expect(isDevOtpExposed(parseEnvOrThrow({ ...base, AUTH_EXPOSE_DEV_CODE: 'true' }))).toBe(true);
  });

  it('defaults DEMO_LIVE_LOCATIONS to DEMO_MODE and requires VAPID keys in pairs', () => {
    expect(parseEnvOrThrow(base).DEMO_LIVE_LOCATIONS).toBe(false);
    expect(parseEnvOrThrow({ ...base, DEMO_MODE: 'true' }).DEMO_LIVE_LOCATIONS).toBe(true);
    expect(parseEnvOrThrow({ ...base, DEMO_MODE: 'true', DEMO_LIVE_LOCATIONS: 'false' }).DEMO_LIVE_LOCATIONS).toBe(false);
    expect(parseEnvOrThrow({ ...base, DEMO_LIVE_LOCATIONS: 'true' }).DEMO_LIVE_LOCATIONS).toBe(true);
    expect(() => parseEnvOrThrow({ ...base, VAPID_PUBLIC_KEY: 'abc' })).toThrow(/VAPID_PRIVATE_KEY/);
    expect(() => parseEnvOrThrow({ ...base, VAPID_SUBJECT: 'admin@example.com' })).toThrow(/VAPID_SUBJECT/);
    expect(parseEnvOrThrow(base).VAPID_SUBJECT).toMatch(/^mailto:/);
  });
});
