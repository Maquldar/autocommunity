import type { Request } from 'express';

/** Caller IP (respecting the trust-proxy setting) and user agent, for rate limits and session records. */
export const clientMeta = (req: Request) => ({
  ip: req.ip ?? req.socket.remoteAddress ?? null,
  userAgent: req.get('user-agent') ?? null,
});
