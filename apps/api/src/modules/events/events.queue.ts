import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { ENV, type Env } from '../../config/env';
import { redisOptionsFromUrl } from '../../infra/redis/redis-options';
import { BackgroundTasks } from '../../infra/tasks/background-tasks';

export const EVENTS_QUEUE_NAME = 'events';

export type ReminderJob = { eventId: string; startsAt: string };

/** One reminder job per (event, start time): a rescheduled event gets a new job id, so ids never collide. */
export const reminderJobId = (eventId: string, startsAt: Date) => `event-reminder-${eventId}-${startsAt.getTime()}`;

/**
 * `event.reminder` delayed jobs (BullMQ): due EVENT_REMINDER_LEAD_MS before the start. PATCH of startsAt
 * removes the old job and adds a new one; delete removes it. The handler re-checks the event (exists,
 * same startsAt, not reminded yet), so a job that couldn't be removed is harmless.
 */
@Injectable()
export class EventsQueue implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(EventsQueue.name);
  private queue!: Queue<ReminderJob>;
  private worker: Worker<ReminderJob> | null = null;
  private handler: ((job: ReminderJob) => Promise<unknown>) | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly tasks: BackgroundTasks,
  ) {}

  /** Set by EventsService (avoids a circular provider dependency). */
  setHandler(handler: (job: ReminderJob) => Promise<unknown>): void {
    this.handler = handler;
  }

  async onModuleInit(): Promise<void> {
    this.queue = new Queue<ReminderJob>(EVENTS_QUEUE_NAME, {
      connection: this.connectionOptions(),
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true, removeOnFail: 500 },
    });
    this.queue.on('error', (err) => this.logger.warn({ err }, 'Events queue error'));
    this.worker = new Worker<ReminderJob>(
      EVENTS_QUEUE_NAME,
      async (job: Job<ReminderJob>) => (job.name === 'event.reminder' && this.handler ? this.handler(job.data) : null),
      { connection: this.connectionOptions(), concurrency: 5 },
    );
    this.worker.on('error', (err) => this.logger.warn({ err }, 'Events worker error'));
    this.tasks.registerProducer('events worker', () => this.worker?.close());
    await Promise.all([this.queue.waitUntilReady(), this.worker.waitUntilReady()]);
    this.worker.on('failed', (job, err) => this.logger.warn({ err, job: job?.name }, 'Events job failed'));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close().catch((err: unknown) => this.logger.warn({ err }, 'Closing the worker failed'));
    await this.queue?.close().catch((err: unknown) => this.logger.warn({ err }, 'Closing the queue failed'));
  }

  /** Schedules the reminder unless its moment has already passed (then nobody would be reminded in time). */
  async scheduleReminder(eventId: string, startsAt: Date): Promise<boolean> {
    const delay = startsAt.getTime() - this.env.EVENT_REMINDER_LEAD_MS - Date.now();
    if (delay < 0) return false;
    await this.queue.add('event.reminder', { eventId, startsAt: startsAt.toISOString() }, { delay, jobId: reminderJobId(eventId, startsAt) });
    return true;
  }

  async cancelReminder(eventId: string, startsAt: Date): Promise<void> {
    await this.queue.remove(reminderJobId(eventId, startsAt)).catch((err: unknown) => this.logger.warn({ err }, 'Removing a reminder failed'));
  }

  /** For tests and diagnostics. */
  get bullQueue(): Queue<ReminderJob> {
    return this.queue;
  }

  private connectionOptions() {
    return redisOptionsFromUrl(this.env.REDIS_URL, { maxRetriesPerRequest: null });
  }
}
