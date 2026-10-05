/** Where signed-in users land (also the PWA manifest start_url). */
export const HOME_ROUTE = '/map';
export const LOGIN_ROUTE = '/login';
export const ONBOARDING_ROUTE = '/onboarding';

/** Accepts only same-origin absolute paths for ?next= (no open redirects, no auth loops). */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if (next === LOGIN_ROUTE || next.startsWith(`${LOGIN_ROUTE}?`) || next.startsWith(ONBOARDING_ROUTE)) return null;
  return next;
}

export function loginUrl(next?: string): string {
  return next && safeNextPath(next) ? `${LOGIN_ROUTE}?next=${encodeURIComponent(next)}` : LOGIN_ROUTE;
}
