import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../../infra/redis/redis.service';
import { BackgroundTasks } from '../../infra/tasks/background-tasks';
import { PremiumService, type RenewalReport } from './premium.service';

export const PREMIUM_RENEWAL_LOCK_KEY = 'premium:renewal:lock';
const DAY_MS = 24 * 3600 * 1000;
const FIRST_RUN_DELAY_MS = 10 * 60 * 1000;

/** Daily premium renewal / expiry / reminders. The ~23 h Redis lock makes it run once a day across instances. */
@Injectable()
export class PremiumRenewalService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PremiumRenewalService.name);
  private readonly instanceId = randomUUID();
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly premium: PremiumService,
    private readonly redis: RedisService,
    private readonly tasks: BackgroundTasks,
  ) {}

  onApplicationBootstrap(): void {
    const run = () => this.tasks.run('Daily premium renewal', () => this.runIfDue());
    this.timers.push(setTimeout(run, FIRST_RUN_DELAY_MS), setInterval(run, DAY_MS));
    for (const t of this.timers) t.unref();
    this.tasks.registerProducer('Daily premium renewal timer', () => this.onApplicationShutdown());
  }

  onApplicationShutdown(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  async runIfDue(now = new Date()): Promise<RenewalReport | null> {
    const won = await this.redis.set(PREMIUM_RENEWAL_LOCK_KEY, this.instanceId, 'PX', DAY_MS - 3600 * 1000, 'NX');
    if (won !== 'OK') return null;
    const report = await this.premium.runRenewals(now);
    this.logger.log(report, 'Daily premium renewal');
    return report;
  }
}
