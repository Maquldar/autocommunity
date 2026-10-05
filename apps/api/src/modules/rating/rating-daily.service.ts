import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../../infra/redis/redis.service';
import { BackgroundTasks } from '../../infra/tasks/background-tasks';
import { RatingService } from './rating.service';

export const RATING_DAILY_LOCK_KEY = 'rating:daily:lock';
const DAY_MS = 24 * 3600 * 1000;
const FIRST_RUN_DELAY_MS = 10 * 60 * 1000;

/** Daily recompute (decay, tenure, activity). The ~23 h Redis lock makes it run once a day across instances. */
@Injectable()
export class RatingDailyService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RatingDailyService.name);
  private readonly instanceId = randomUUID();
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly rating: RatingService,
    private readonly redis: RedisService,
    private readonly tasks: BackgroundTasks,
  ) {}

  onApplicationBootstrap(): void {
    const run = () => this.tasks.run('Daily rating recompute', () => this.runIfDue());
    this.timers.push(setTimeout(run, FIRST_RUN_DELAY_MS), setInterval(run, DAY_MS));
    for (const t of this.timers) t.unref();
    this.tasks.registerProducer('Daily rating recompute timer', () => this.onApplicationShutdown());
  }

  onApplicationShutdown(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  async runIfDue(now = new Date()): Promise<number | null> {
    const won = await this.redis.set(RATING_DAILY_LOCK_KEY, this.instanceId, 'PX', DAY_MS - 3600 * 1000, 'NX');
    if (won !== 'OK') return null;
    const changed = await this.rating.recomputeAll(now);
    this.logger.log(`Daily rating recompute: ${changed} users changed`);
    return changed;
  }
}
