import { Global, Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { PrismaService } from './prisma/prisma.service';
import { RateLimiterService } from './rate-limit/rate-limiter.service';
import { RedisService } from './redis/redis.service';
import { createSmsSender } from './sms/create-sms-sender';
import { SmsSender } from './sms/sms-sender';
import { createStorage } from './storage/create-storage';
import { Storage } from './storage/storage';

@Global()
@Module({
  providers: [
    PrismaService,
    { provide: RedisService, inject: [ENV], useFactory: (env: Env) => new RedisService(env.REDIS_URL) },
    RateLimiterService,
    { provide: SmsSender, inject: [ENV], useFactory: createSmsSender },
    { provide: Storage, inject: [ENV, PrismaService], useFactory: createStorage },
  ],
  exports: [PrismaService, RedisService, RateLimiterService, SmsSender, Storage],
})
export class InfraModule {}
