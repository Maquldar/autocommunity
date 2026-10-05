import { Inject, Logger, OnApplicationShutdown } from '@nestjs/common';
import { OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import Redis from 'ioredis';
import type { Namespace, Socket } from 'socket.io';
import { AccessTokenService } from '../../common/auth/access-token.service';
import { SESSION_REVOKED_CHANNEL } from '../../common/auth/session.service';
import { isUserBlocked, UserStateService } from '../../common/auth/user-state.service';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RealtimeService, userRoom } from './realtime.service';

export const REALTIME_NAMESPACE = '/rt';

export type SocketData = { userId: string };

/** Handshake failure surfaced to the client as `connect_error` with `message === 'UNAUTHORIZED'`. */
function unauthorized(code: 'UNAUTHORIZED' | 'ACCOUNT_BLOCKED' = 'UNAUTHORIZED'): Error {
  const err = new Error('UNAUTHORIZED') as Error & { data: { code: string } };
  err.data = { code };
  return err;
}

/**
 * Socket.IO namespace `/rt`. The handshake carries the access token (`auth: { token }`); it is verified like
 * an HTTP Bearer token (signature, expiry, session revocation, blocked account) and the socket joins
 * `user:{id}`. Session revocations published on Redis disconnect the user's sockets on every instance.
 */
@WebSocketGateway({ namespace: REALTIME_NAMESPACE })
export class RealtimeGateway implements OnGatewayInit<Namespace>, OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeGateway.name);
  private ns!: Namespace;
  private subscriber: Redis | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly tokens: AccessTokenService,
    private readonly userState: UserStateService,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(ns: Namespace): void {
    this.ns = ns;
    this.realtime.attach(ns);
    ns.use((socket, next) => {
      this.authenticate(socket).then(
        () => next(),
        (err: unknown) => next(err instanceof Error && err.message === 'UNAUTHORIZED' ? err : unauthorized()),
      );
    });
    ns.on('connection', (socket: Socket) => this.onConnection(socket));
    this.subscribeToRevocations();
  }

  async onApplicationShutdown(): Promise<void> {
    const sub = this.subscriber;
    this.subscriber = null;
    if (sub) await sub.quit().catch(() => sub.disconnect());
  }

  private async authenticate(socket: Socket): Promise<void> {
    const auth = socket.handshake.auth as { token?: unknown } | undefined;
    const token = typeof auth?.token === 'string' ? auth.token.replace(/^Bearer\s+/i, '') : null;
    if (!token) throw unauthorized();
    const claims = await this.tokens.verify(token);
    if (!claims) throw unauthorized();
    const { state, revokedBeforeMs } = await this.userState.getForAuth(claims.sub);
    if (!state) throw unauthorized();
    if (revokedBeforeMs !== null && claims.issuedAtMs <= revokedBeforeMs) throw unauthorized();
    if (isUserBlocked(state)) throw unauthorized('ACCOUNT_BLOCKED');
    (socket.data as SocketData).userId = claims.sub;
    // Joined before `connect` reaches the client, so no event emitted after that can be missed.
    await socket.join(userRoom(claims.sub));
  }

  /** Sends the current unread count so the badge is right after (re)connecting. */
  private onConnection(socket: Socket): void {
    const { userId } = socket.data as SocketData;
    this.prisma.notification
      .count({ where: { userId, readAt: null } })
      .then((count) => socket.emit('notification:count', { count }))
      .catch((err: unknown) => this.logger.warn({ err }, 'Failed to send the unread count'));
  }

  private subscribeToRevocations(): void {
    const sub = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.subscriber = sub;
    sub.on('error', (err) => this.logger.warn({ err }, 'Session revocation subscriber error'));
    sub.on('message', (_channel: string, message: string) => {
      let userId: unknown;
      try {
        userId = (JSON.parse(message) as { userId?: unknown }).userId;
      } catch {
        return;
      }
      if (typeof userId === 'string') this.revokeLocal(userId);
    });
    sub.subscribe(SESSION_REVOKED_CHANNEL).catch((err: unknown) => this.logger.error({ err }, 'Failed to subscribe to session revocations'));
  }

  /**
   * Every instance receives the Redis message, so each one handles only its own sockets. A namespace-level
   * disconnect is queued after the event in the same transport buffer, so polling clients get both.
   */
  private revokeLocal(userId: string): void {
    const room = this.ns.local.to(userRoom(userId));
    room.emit('session:revoked', {});
    room.disconnectSockets(false);
  }
}
