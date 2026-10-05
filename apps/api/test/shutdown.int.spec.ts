import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RealtimeService } from '../src/modules/realtime/realtime.service';
import { BackgroundTasks } from '../src/infra/tasks/background-tasks';
import { createTestApp, createUser, type TestApp } from './support/app';

/**
 * Regression: closing apps right after they start (as tests and short-lived processes do) used to leave
 * BullMQ handshakes and fire-and-forget emits running against closed Redis connections → unhandled
 * "Connection is closed" rejections after the tests had passed.
 */
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

let t: TestApp;
beforeAll(async () => {
  process.on('unhandledRejection', onUnhandled);
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
  await new Promise((r) => setTimeout(r, 200));
  process.off('unhandledRejection', onUnhandled);
  expect(unhandled).toEqual([]);
});

describe('clean shutdown', () => {
  it('survives rapid init → close cycles without unhandled rejections', async () => {
    for (let i = 0; i < 10; i++) {
      const app = await createTestApp();
      await app.close();
    }
    await new Promise((r) => setTimeout(r, 200));
    expect(unhandled).toEqual([]);
  });

  it('drains in-flight background work (emits, deliveries) before Redis closes', async () => {
    const app = await createTestApp();
    const u = await createUser(app);
    const tasks = app.app.get(BackgroundTasks);
    let finished = 0;
    for (let i = 0; i < 20; i++) {
      tasks.run('test emit', async () => {
        await new Promise((r) => setTimeout(r, 30));
        app.app.get(RealtimeService).emitToUser(u.id, 'friends:changed', {});
        await app.redis.get('x');
        finished++;
      });
    }
    await app.close(); // must wait for all 20 before tearing down Socket.IO/Redis
    expect(finished).toBe(20);
    await new Promise((r) => setTimeout(r, 200));
    expect(unhandled).toEqual([]);
  });
});
