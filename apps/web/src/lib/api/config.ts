/**
 * Origin of the AutoCommunity API (apps/api). Inlined at build time.
 * `/` means same origin: the web server proxies /api/v1 and /media to API_PROXY_TARGET (see next.config.ts),
 * which keeps the refresh cookie first-party on hosts where web and API live on different domains.
 */
const configured = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const API_ORIGIN = configured === '/' ? '' : configured.replace(/\/+$/, '');
export const API_BASE_URL = `${API_ORIGIN}/api/v1`;

/** Readable double-submit cookie set by the API next to the httpOnly refresh cookie (API.md §0). */
export const CSRF_COOKIE = 'ac_csrf';
export const CSRF_HEADER = 'X-CSRF-Token';
