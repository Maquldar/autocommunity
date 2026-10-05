import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import type { IncomingMessage } from 'node:http';
import type { Env } from '../../config/env';

/** Socket.IO path; the web app's same-origin proxy forwards it to the API. */
export const SOCKET_PATH = '/socket.io';

/**
 * Socket.IO server attached to the HTTP server, with the same origin allow-list as the REST API and the
 * Redis adapter so a room emit reaches sockets on every API instance. Long-polling and WebSocket are both
 * enabled; the client may stay on polling behind proxies that don't upgrade.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly clients: Redis[] = [];

  constructor(
    app: INestApplicationContext,
    private readonly env: Env,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const allowed = this.env.WEB_ORIGIN;
    const server = super.createIOServer(port, {
      ...options,
      path: SOCKET_PATH,
      serveClient: false,
      transports: ['polling', 'websocket'],
      cors: { origin: allowed, credentials: true },
      // CORS only constrains browsers on polling; WebSocket upgrades carry Origin but aren't CORS-checked.
      allowRequest: (req: IncomingMessage, done: (err: string | null | undefined, success: boolean) => void) => {
        const origin = req.headers.origin;
        done(null, origin === undefined || allowed.includes(origin));
      },
    }) as Server;
    const pub = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    const sub = pub.duplicate();
    this.clients.push(pub, sub);
    server.adapter(createAdapter(pub, sub));
    return server;
  }

  override async dispose(): Promise<void> {
    await Promise.all(this.clients.map((c) => c.quit().catch(() => c.disconnect())));
    this.clients.length = 0;
  }
}
