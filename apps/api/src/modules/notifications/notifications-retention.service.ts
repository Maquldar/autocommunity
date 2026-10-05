import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { BackgroundTasks } from '../../infra/tasks/background-tasks';

/** Read notifications older than this are deleted; unread ones are kept. */
export const NOTIFICATION_RETENTION_DAYS = 90;
export const RETENTION_LOCK_KEY = 'notifications:retention:lock';
const DAY_MS = 24 * 3600 * 1000;
/** First run a few minutes after boot (hosts that sleep may never reach a 24 h timer), then daily. */
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;
const BATCH = 5000;

/**
 * Daily purge of old read notifications. The Redis lock (held ~23 h) makes it run at most once a day
 * across instances and restarts.
 */
@Injectable()
export class NotificationsRetentionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationsRetentionService.name);
  private readonly instanceId = randomUUID();
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tasks: BackgroundTasks,
  ) {}

  onApplicationBootstrap(): void {
    const run = () => this.tasks.run('Notification retention', () => this.runIfDue());
    this.timers.push(setTimeout(run, FIRST_RUN_DELAY_MS), setInterval(run, DAY_MS));
    for (const t of this.timers) t.unref();
    this.tasks.registerProducer('Notification retention timer', () => this.onApplicationShutdown());
  }

  onApplicationShutdown(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  /** Runs the purge unless it already ran (on any instance) in the last ~23 h. Returns deleted rows or null. */
  async runIfDue(): Promise<number | null> {
    const won = await this.redis.set(RETENTION_LOCK_KEY, this.instanceId, 'PX', DAY_MS - 3600 * 1000, 'NX');
    return won === 'OK' ? this.purge() : null;
  }

  /** Deletes in batches (TID scan per batch) so no long-running statement holds locks. */
  async purge(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * DAY_MS);
    let total = 0;
    for (;;) {
      const deleted = await this.prisma.$executeRaw`
        DELETE FROM notifications WHERE ctid = ANY(ARRAY(
          SELECT ctid FROM notifications WHERE read_at IS NOT NULL AND created_at < ${cutoff} LIMIT ${BATCH}::int))`;
      total += deleted;
      if (deleted < BATCH) break;
    }
    if (total) this.logger.log(`Deleted ${total} read notifications older than ${NOTIFICATION_RETENTION_DAYS} days`);
    return total;
  }
}
