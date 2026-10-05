import type { RedisOptions } from 'ioredis';

/**
 * ioredis options from a redis:// or rediss:// URL. Used for BullMQ, which then *owns* its connections and
 * closes them itself in `close()` — passing shared ioredis instances instead leaves BullMQ's own
 * initialisation (and the stalled-jobs checker) running against connections we already quit.
 */
export function redisOptionsFromUrl(url: string, extra: RedisOptions = {}): RedisOptions {
  const u = new URL(url);
  const db = u.pathname.replace(/^\//, '');
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(db ? { db: Number(db) } : {}),
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
    ...extra,
  };
}
