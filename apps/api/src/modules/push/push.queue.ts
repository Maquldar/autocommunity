import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import type { PushPayload } from '@autoc/shared';
import { Queue, Worker, type Job } from 'bullmq';
import { ENV, type Env } from '../../config/env';
import { redisOptionsFromUrl } from '../../infra/redis/redis-options';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BackgroundTasks } from '../../infra/tasks/background-tasks';
import { PushDeliveryService, type DeliveryResult } from './push-delivery.service';

export const PUSH_QUEUE_NAME = 'push';

export type PushJobData = { subscriptionId: string; payload: PushPayload };

/** Retries cover push-service hiccups (429/5xx/network): ~10 s, 20 s, 40 s, 80 s. */
const JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: true,
  removeOnFail: 500,
} as const;

/**
 * Web Push delivery through BullMQ (Redis): one job per subscription, so a retry never re-sends to devices
 * that already got the message. The worker runs inside the API process (the demo host runs a single
 * process); with several instances BullMQ hands each job to exactly one worker.
 */
@Injectable()
export class PushQueue implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PushQueue.name);
  private queue!: Queue<PushJobData>;
  private worker: Worker<PushJobData, DeliveryResult> | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly delivery: PushDeliveryService,
    private readonly tasks: BackgroundTasks,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue<PushJobData>(PUSH_QUEUE_NAME, { connection: this.connectionOptions(), defaultJobOptions: JOB_OPTIONS });
    this.queue.on('error', (err) => this.logger.warn({ err }, 'Push queue error'));
    this.worker = new Worker<PushJobData, DeliveryResult>(
      PUSH_QUEUE_NAME,
      (job: Job<PushJobData>) => this.delivery.deliver(job.data.subscriptionId, job.data.payload),
      { connection: this.connectionOptions(), concurrency: 10 },
    );
    this.worker.on('error', (err) => this.logger.warn({ err }, 'Push worker error'));
    this.tasks.registerProducer('push worker', () => this.worker?.close());
    // app.init() resolves only once BullMQ is connected, so a quick init → close never tears down a handshake.
    await Promise.all([this.queue.waitUntilReady(), this.worker.waitUntilReady()]);
    this.worker.on('failed', (job, err) =>
      this.logger.warn({ err, attemptsMade: job?.attemptsMade }, 'Push delivery attempt failed'),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close().catch((err: unknown) => this.logger.warn({ err }, 'Closing the worker failed'));
    await this.queue?.close().catch((err: unknown) => this.logger.warn({ err }, 'Closing the queue failed'));
  }

  /** Queues the payload for each of the user's subscriptions. */
  async enqueueForUser(userId: string, payload: PushPayload): Promise<number> {
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId }, select: { id: true } });
    if (!subs.length) return 0;
    await this.queue.addBulk(subs.map((s) => ({ name: 'deliver', data: { subscriptionId: s.id, payload }, opts: JOB_OPTIONS })));
    return subs.length;
  }

  /** Several users at once: one subscription query, one bulk enqueue. */
  async enqueueForUsers(items: { userId: string; payload: PushPayload }[]): Promise<number> {
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId: { in: [...new Set(items.map((i) => i.userId))] } }, select: { id: true, userId: true } });
    if (!subs.length) return 0;
    const byUser = new Map(items.map((i) => [i.userId, i.payload]));
    await this.queue.addBulk(subs.map((s) => ({ name: 'deliver', data: { subscriptionId: s.id, payload: byUser.get(s.userId)! }, opts: JOB_OPTIONS })));
    return subs.length;
  }

  /** For tests and diagnostics. */
  get bullQueue(): Queue<PushJobData> {
    return this.queue;
  }

  /** BullMQ owns (creates and closes) its connections; maxRetriesPerRequest: null is required by workers. */
  private connectionOptions() {
    return redisOptionsFromUrl(this.env.REDIS_URL, { maxRetriesPerRequest: null });
  }
}
