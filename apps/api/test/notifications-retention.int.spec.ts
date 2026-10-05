import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../src/common/ids';
import { NotificationsRetentionService, RETENTION_LOCK_KEY } from '../src/modules/notifications/notifications-retention.service';
import { createTestApp, createUser, type TestApp } from './support/app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('notification retention', () => {
  it('deletes read notifications older than 90 days only, once a day across instances', async () => {
    const u = await createUser(t);
    const day = 24 * 3600 * 1000;
    const mk = (ageDays: number, read: boolean) => ({
      id: newId(),
      userId: u.id,
      type: 'friend_request',
      payload: { ageDays, read },
      createdAt: new Date(Date.now() - ageDays * day),
      readAt: read ? new Date(Date.now() - (ageDays - 1) * day) : null,
    });
    await t.prisma.notification.createMany({ data: [mk(120, true), mk(91, true), mk(89, true), mk(200, false), mk(1, true)] });
    await t.redis.del(RETENTION_LOCK_KEY);
    const service = t.app.get(NotificationsRetentionService);
    expect(await service.runIfDue()).toBe(2);
    const left = await t.prisma.notification.findMany({ where: { userId: u.id } });
    expect(left.map((n) => (n.payload as { ageDays: number }).ageDays).sort((a, b) => a - b)).toEqual([1, 89, 200]);
    // Locked for the day (also for another instance).
    const other = await createTestApp();
    try {
      expect(await other.app.get(NotificationsRetentionService).runIfDue()).toBeNull();
    } finally {
      await other.close();
    }
  });
});
