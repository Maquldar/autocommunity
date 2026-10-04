import { Inject, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import { ENV, isCookieSecure, type Env } from '../../config/env';
import { Errors } from '../errors/api-exception';

export const REFRESH_COOKIE = 'ac_rt';
export const CSRF_COOKIE = 'ac_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Refresh-token cookie (httpOnly) + double-submit CSRF cookie (readable by the web app). */
@Injectable()
export class AuthCookies {
  private readonly base: CookieOptions;

  constructor(@Inject(ENV) env: Env) {
    this.base = { secure: isCookieSecure(env), sameSite: 'strict', domain: env.COOKIE_DOMAIN };
  }

  set(res: Response, refreshToken: string, csrfToken: string): void {
    res.cookie(REFRESH_COOKIE, refreshToken, { ...this.base, httpOnly: true, path: REFRESH_COOKIE_PATH, maxAge: REFRESH_TTL_MS });
    res.cookie(CSRF_COOKIE, csrfToken, { ...this.base, httpOnly: false, path: '/', maxAge: REFRESH_TTL_MS });
  }

  clear(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, { ...this.base, httpOnly: true, path: REFRESH_COOKIE_PATH });
    res.clearCookie(CSRF_COOKIE, { ...this.base, httpOnly: false, path: '/' });
  }

  readRefresh(req: Request): string | null {
    const value: unknown = req.cookies?.[REFRESH_COOKIE];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  readCsrf(req: Request): string | null {
    const value: unknown = req.cookies?.[CSRF_COOKIE];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  /** Cookie-authenticated routes must echo the CSRF cookie in the X-CSRF-Token header. */
  assertCsrf(req: Request): void {
    const cookie = this.readCsrf(req);
    const header = req.get(CSRF_HEADER);
    if (!cookie || !header || !safeEqual(cookie, header)) throw Errors.forbidden('CSRF token missing or invalid', 'CSRF_FAILED');
  }
}
