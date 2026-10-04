import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Errors } from '../../common/errors/api-exception';
import { RedisService } from '../redis/redis.service';

export type RateRule = {
  /** Unique key, e.g. `otp:phone:+7701…`. Prefixed with `rl:` in Redis. */
  key: string;
  limit: number;
  windowSec: number;
};

export type RateResult = { allowed: boolean; retryAfterSec: number };
/** A recorded hit that can be refunded (e.g. a failure slot reserved before a check that then succeeded). */
export type RateHit = { rules: RateRule[]; member: string };

/*
 * Sliding-window log over several rules evaluated atomically: either every rule has room and a hit is
 * recorded in all of them, or nothing is recorded and the longest wait is returned.
 * ARGV: nowMs, member, mode ("consume" | "check"), then limit/windowMs pairs per key.
 */
const SCRIPT = `
local now = tonumber(ARGV[1])
local member = ARGV[2]
local consume = ARGV[3] == 'consume'
local wait = 0
for i, key in ipairs(KEYS) do
  local limit = tonumber(ARGV[2 + i * 2])
  local window = tonumber(ARGV[3 + i * 2])
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
  if redis.call('ZCARD', key) >= limit then
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local w = tonumber(oldest[2]) + window - now
    if w > wait then wait = w end
  end
end
if wait > 0 then return wait end
if consume then
  for i, key in ipairs(KEYS) do
    local window = tonumber(ARGV[3 + i * 2])
    redis.call('ZADD', key, now, member)
    redis.call('PEXPIRE', key, window)
  end
end
return 0
`;

@Injectable()
export class RateLimiterService {
  constructor(private readonly redis: RedisService) {}

  /** Records a hit in every rule if all have room. */
  async consume(rules: RateRule[]): Promise<RateResult> {
    return (await this.run(rules, 'consume')).result;
  }

  /** Like `consumeOrThrow`, returning a handle for `refund`. */
  async reserveOrThrow(rules: RateRule[]): Promise<RateHit> {
    const { result, member } = await this.run(rules, 'consume');
    if (!result.allowed) throw Errors.rateLimited(result.retryAfterSec);
    return { rules, member };
  }

  /** Removes a previously recorded hit from every rule it was recorded in. */
  async refund(hit: RateHit): Promise<void> {
    const pipeline = this.redis.pipeline();
    for (const r of hit.rules) pipeline.zrem(`rl:${r.key}`, hit.member);
    await pipeline.exec();
  }

  /** Checks without recording a hit. */
  async check(rules: RateRule[]): Promise<RateResult> {
    return (await this.run(rules, 'check')).result;
  }

  /** Like `consume`, but throws RATE_LIMITED (429) when blocked. */
  async consumeOrThrow(rules: RateRule[]): Promise<void> {
    const r = await this.consume(rules);
    if (!r.allowed) throw Errors.rateLimited(r.retryAfterSec);
  }

  async checkOrThrow(rules: RateRule[]): Promise<void> {
    const r = await this.check(rules);
    if (!r.allowed) throw Errors.rateLimited(r.retryAfterSec);
  }

  async reset(keys: string[]): Promise<void> {
    if (keys.length) await this.redis.del(...keys.map((k) => `rl:${k}`));
  }

  private async run(rules: RateRule[], mode: 'consume' | 'check'): Promise<{ result: RateResult; member: string }> {
    const member = `${Date.now()}-${randomBytes(6).toString('hex')}`;
    if (!rules.length) return { result: { allowed: true, retryAfterSec: 0 }, member };
    const args: (string | number)[] = [Date.now(), member, mode];
    for (const r of rules) args.push(r.limit, r.windowSec * 1000);
    const waitMs = (await this.redis.eval(
      SCRIPT,
      rules.length,
      ...rules.map((r) => `rl:${r.key}`),
      ...args,
    )) as number;
    const result: RateResult =
      waitMs > 0 ? { allowed: false, retryAfterSec: Math.max(1, Math.ceil(waitMs / 1000)) } : { allowed: true, retryAfterSec: 0 };
    return { result, member };
  }
}
