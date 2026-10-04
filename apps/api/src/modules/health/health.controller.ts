import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/auth/decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';

type Check = 'ok' | 'error';

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref())]);

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<{ status: Check; db: Check; redis: Check }> {
    const [db, redis] = await Promise.all([
      withTimeout(this.prisma.$queryRaw`SELECT 1`, 2000).then((): Check => 'ok', (): Check => 'error'),
      withTimeout(this.redis.ping(), 2000).then((r): Check => (r === 'PONG' ? 'ok' : 'error'), (): Check => 'error'),
    ]);
    const status: Check = db === 'ok' && redis === 'ok' ? 'ok' : 'error';
    res.status(status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    res.setHeader('Cache-Control', 'no-store');
    return { status, db, redis };
  }
}
