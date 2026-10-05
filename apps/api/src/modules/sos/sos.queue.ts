import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { SOS_LIMITS } from '@autoc/shared';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { ENV, type Env } from '../../config/env';
import { RedisService } from '../../infra/redis/redis.service';
import { SosDispatchService } from './sos-dispatch.service';

export const SOS_QUEUE_NAME = 'sos';
type DispatchJob = { sosId: string; step: number };
type ExpireJob = { sosId: string };
const SWEEP_MS = 60_000;
const SWEEP_LOCK = 'sos:expire-sweep:lock';

/**
 * BullMQ jobs `sos.dispatch` (steps at 0, +delay, +2·delay — each checks the SOS is still `created`) and
 * `sos.expire` (at expiresAt). Deterministic job ids make enqueueing idempotent. A once-a-minute sweep
 * (Redis lock) expires overdue SOS in case a delayed job was lost.
 */
@Injectable()
export class SosQueue implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SosQueue.name);
  private readonly connections: Redis[] = [];
  private readonly instanceId = randomUUID();
  private queue!: Queue;
  private worker: Worker | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly dispatch: SosDispatchService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    this.queue = new Queue(SOS_QUEUE_NAME, {
      connection: this.connection(),
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true, removeOnFail: 500 },
    });
    this.queue.on('error', (err) => this.logger.warn({ err }, 'SOS queue error'));
    this.worker = new Worker(
      SOS_QUEUE_NAME,
      async (job: Job) => {
        if (job.name === 'sos.dispatch') return this.dispatch.dispatch((job.data as DispatchJob).sosId, (job.data as DispatchJob).step);
        if (job.name === 'sos.expire') return this.dispatch.expire((job.data as ExpireJob).sosId);
        return null;
      },
      { connection: this.connection(), concurrency: 5 },
    );
    this.worker.on('error', (err) => this.logger.warn({ err }, 'SOS worker error'));
    this.worker.on('failed', (job, err) => this.logger.warn({ err, job: job?.name }, 'SOS job failed'));
  }

  onApplicationBootstrap(): void {
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.sweepTimer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    await Promise.all(this.connections.map((c) => c.quit().catch(() => c.disconnect())));
  }

  /** Dispatch now, then the two radius expansions; expiry at `expiresAt`. */
  async scheduleNew(sosId: string, expiresAt: Date): Promise<void> {
    const step = this.env.SOS_EXPAND_DELAY_MS;
    await this.queue.addBulk([
      ...SOS_LIMITS.radiiM.map((_, i) => ({
        name: 'sos.dispatch',
        data: { sosId, step: i } satisfies DispatchJob,
        opts: { delay: i * step, jobId: `sos-dispatch-${sosId}-${i}` },
      })),
      {
        name: 'sos.expire',
        data: { sosId } satisfies ExpireJob,
        opts: { delay: Math.max(0, expiresAt.getTime() - Date.now()), jobId: `sos-expire-${sosId}` },
      },
    ]);
  }

  /** For tests and diagnostics. */
  get bullQueue(): Queue {
    return this.queue;
  }

  private async sweep(): Promise<void> {
    try {
      const won = await this.redis.set(SWEEP_LOCK, this.instanceId, 'PX', SWEEP_MS - 5000, 'NX');
      if (won === 'OK') await this.dispatch.sweepExpired();
    } catch (err) {
      this.logger.warn({ err }, 'SOS expiry sweep failed');
    }
  }

  private connection(): Redis {
    const c = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    c.on('error', () => undefined);
    this.connections.push(c);
    return c;
  }
}
