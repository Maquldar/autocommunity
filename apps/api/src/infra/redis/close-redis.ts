import type Redis from 'ioredis';

/**
 * Closes an ioredis client cleanly. Quitting while the client is still in its connect handshake makes
 * ioredis reject the handshake/queued commands with "Connection is closed" — so an in-flight connect is
 * awaited first (bounded), then QUIT flushes and closes. A client that never connected is just disconnected.
 */
export async function closeRedis(client: Redis, timeoutMs = 2000): Promise<void> {
  if (client.status === 'end') return;
  if (client.status === 'wait') {
    client.disconnect();
    return;
  }
  if (client.status !== 'ready') {
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        client.off('ready', done);
        client.off('end', done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      client.once('ready', done);
      client.once('end', done);
    });
  }
  // Re-read: the status changed while we waited.
  const status = client.status as string;
  if (status === 'ready') await client.quit();
  else if (status !== 'end') client.disconnect();
}
