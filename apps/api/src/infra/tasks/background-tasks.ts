import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';

type Producer = { name: string; stop: () => Promise<unknown> | unknown };

/**
 * Background work that must not outlive the app: fire-and-forget deliveries (socket emits, pushes, rating
 * refreshes), timers and queue workers.
 *
 * Nest closes in this order: destroy hooks → `beforeApplicationShutdown` → dispose (Socket.IO server + its
 * Redis adapter, HTTP server) → `onApplicationShutdown` (Redis/Prisma clients). Work still running after
 * dispose emits on a closed Redis connection. So here, before dispose, we first stop every producer of new
 * work (timers, BullMQ workers — `worker.close()` waits for active jobs), then wait until all tracked tasks
 * have settled, including tasks those producers started while stopping.
 */
@Injectable()
export class BackgroundTasks implements BeforeApplicationShutdown {
  private readonly logger = new Logger(BackgroundTasks.name);
  private readonly pending = new Set<Promise<void>>();
  private readonly producers: Producer[] = [];

  /** Runs `fn` in the background; failures are logged with `label`, never thrown to the caller. */
  run(label: string, fn: () => Promise<unknown>): void {
    const task: Promise<void> = Promise.resolve()
      .then(fn)
      .then(
        () => undefined,
        (err: unknown) => this.logger.warn({ err }, `${label} failed`),
      )
      .finally(() => this.pending.delete(task));
    this.pending.add(task);
  }

  /** Something that creates background work (timer, queue worker); `stop` is awaited before draining. */
  registerProducer(name: string, stop: () => Promise<unknown> | unknown): void {
    this.producers.push({ name, stop });
  }

  /** Resolves when no task is pending (tasks may start further tasks). */
  async drain(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  async beforeApplicationShutdown(): Promise<void> {
    const results = await Promise.allSettled(this.producers.map((p) => Promise.resolve().then(p.stop)));
    results.forEach((r, i) => {
      if (r.status === 'rejected') this.logger.warn({ err: r.reason }, `Stopping ${this.producers[i]!.name} failed`);
    });
    await this.drain();
  }
}
