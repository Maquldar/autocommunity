// TEMPORARY instrumentation: which ioredis command rejects unhandled at teardown?
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../src/common/ids';
import { NotificationsRetentionService, RETENTION_LOCK_KEY } from '../src/modules/notifications/notifications-retention.service';
import { createTestApp, createUser, type TestApp } from './support/app';

const origSend = (Redis.prototype as unknown as { sendCommand: (cmd: { name: string; promise: Promise<unknown>; args: unknown[] }) => unknown }).sendCommand;
const seen: string[] = [];
(Redis.prototype as unknown as { sendCommand: unknown }).sendCommand = function (this: Redis, cmd: { name: string; promise: Promise<unknown>; args: unknown[] }) {
  const site = new Error('site').stack!.split('\n').slice(2, 14).filter((l) => !l.includes('ioredis/built')).join('\n');
  const status = this.status;
  cmd.promise.catch((err: Error) => {
    if (/Connection is closed/.test(err.message)) seen.push(`${cmd.name} ${JSON.stringify(cmd.args).slice(0, 80)} (client status at send: ${status})\n${site}`);
  });
  return origSend.call(this, cmd);
};

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
  await new Promise((r) => setTimeout(r, 300));
  console.log(`CLOSED-REJECTIONS ${seen.length}\n${seen.join('\n----\n')}`);
});

describe('debug', () => {
  for (let i = 0; i < 15; i++) {
    it(`create + close a second app (${i})`, async () => {
      const u = await createUser(t);
      await t.prisma.notification.create({ data: { id: newId(), userId: u.id, type: 'x', payload: {}, readAt: new Date(), createdAt: new Date(Date.now() - 100 * 86400e3) } });
      await t.redis.del(RETENTION_LOCK_KEY);
      await t.app.get(NotificationsRetentionService).runIfDue();
      const other = await createTestApp();
      await other.close();
      expect(true).toBe(true);
    });
  }
});
