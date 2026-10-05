import { OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { closeRedis } from './close-redis';

/** Shared ioredis connection for caches, rate limits and pub/sub publishing. */
export class RedisService extends Redis implements OnApplicationShutdown {
  constructor(url: string) {
    super(url, { maxRetriesPerRequest: 3, enableReadyCheck: true });
  }

  async onApplicationShutdown(): Promise<void> {
    await closeRedis(this);
  }
}
