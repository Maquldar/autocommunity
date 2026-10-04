/** Origin of the AutoCommunity API (apps/api). Inlined at build time. */
export const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
export const API_BASE_URL = `${API_ORIGIN}/api/v1`;

/** Readable double-submit cookie set by the API next to the httpOnly refresh cookie (API.md §0). */
export const CSRF_COOKIE = 'ac_csrf';
export const CSRF_HEADER = 'X-CSRF-Token';
