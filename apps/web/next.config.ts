import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const isDev = process.env.NODE_ENV !== 'production';

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

const apiOrigin = originOf(process.env.NEXT_PUBLIC_API_URL) ?? 'http://localhost:4000';
// Socket.IO upgrades to WebSocket on the same host, so allow the ws(s):// form too.
const apiWsOrigin = apiOrigin.replace(/^http/, 'ws');
const mapStyleOrigin = originOf(process.env.NEXT_PUBLIC_MAP_STYLE_URL);

const tileHosts = ['https://*.tile.openstreetmap.org', 'https://tiles.openfreemap.org'];
// Google Identity Services and Sign in with Apple JS. Only used when GET /auth/providers enables them.
const googleSignIn = 'https://accounts.google.com';
const appleSignIn = ['https://appleid.cdn-apple.com', 'https://appleid.apple.com'];

function directive(name: string, sources: Array<string | null | false>): string {
  const unique = [...new Set(sources.filter((s): s is string => Boolean(s)))];
  return `${name} ${unique.join(' ')}`;
}

const contentSecurityPolicy = [
  directive('default-src', ["'self'"]),
  // Next.js App Router injects inline bootstrap scripts; 'unsafe-eval' is only needed by the dev overlay / HMR.
  directive('script-src', ["'self'", "'unsafe-inline'", isDev && "'unsafe-eval'", googleSignIn, appleSignIn[0]!]),
  // Radix, MapLibre and next/font inject inline styles.
  directive('style-src', ["'self'", "'unsafe-inline'", googleSignIn]),
  directive('img-src', ["'self'", 'data:', 'blob:', 'https:', apiOrigin]),
  directive('media-src', ["'self'", 'blob:', apiOrigin, 'https:']),
  directive('font-src', ["'self'", 'data:']),
  directive('connect-src', [
    "'self'",
    apiOrigin,
    apiWsOrigin,
    ...tileHosts,
    mapStyleOrigin,
    googleSignIn,
    ...appleSignIn,
    isDev && 'ws:',
  ]),
  // MapLibre GL spins up its tile workers from blob: URLs.
  directive('worker-src', ["'self'", 'blob:']),
  directive('child-src', ["'self'", 'blob:']),
  directive('manifest-src', ["'self'"]),
  directive('frame-src', [googleSignIn, ...appleSignIn]),
  directive('frame-ancestors', ["'none'"]),
  directive('object-src', ["'none'"]),
  directive('base-uri', ["'self'"]),
  directive('form-action', ["'self'"]),
  // Only for real HTTPS deployments; on http://localhost it would break `next start`.
  !isDev && apiOrigin.startsWith('https:') ? 'upgrade-insecure-requests' : null,
]
  .filter(Boolean)
  .join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    key: 'Permissions-Policy',
    // Location (map, SOS), camera (photos) and microphone (voice messages) are core features.
    value: 'geolocation=(self), camera=(self), microphone=(self), payment=(), usb=(), interest-cohort=()',
  },
  ...(isDev
    ? []
    : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@autoc/shared'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
