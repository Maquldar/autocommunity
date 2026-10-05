import { describe, expect, it } from 'vitest';
import { BackgroundTasks } from './background-tasks';

describe('BackgroundTasks', () => {
  it('stops producers first, then waits for every task (including ones started while stopping)', async () => {
    const tasks = new BackgroundTasks();
    const order: string[] = [];
    tasks.registerProducer('worker', async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push('producer stopped');
      tasks.run('late', async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push('late task done');
      });
    });
    tasks.run('early', async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push('early task done');
    });
    await tasks.beforeApplicationShutdown();
    expect(order).toEqual(['early task done', 'producer stopped', 'late task done']);
  });

  it('logs task failures instead of rejecting', async () => {
    const tasks = new BackgroundTasks();
    tasks.run('boom', async () => {
      throw new Error('boom');
    });
    await expect(tasks.drain()).resolves.toBeUndefined();
  });
});
