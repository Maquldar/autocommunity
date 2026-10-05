import { Inject, Logger, OnApplicationShutdown } from '@nestjs/common';
import { OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import { Prisma } from '@prisma/client';
import Redis from 'ioredis';
import type { Namespace, Socket } from 'socket.io';
import { AccessTokenService } from '../../common/auth/access-token.service';
import { SESSION_REVOKED_CHANNEL } from '../../common/auth/session.service';
import { isUserBlocked, UserStateService } from '../../common/auth/user-state.service';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { chatRefSchema, CHAT_LIMITS } from '@autoc/shared';
import { closeRedis } from '../../infra/redis/close-redis';
import { RedisService } from '../../infra/redis/redis.service';
import { BackgroundTasks } from '../../infra/tasks/background-tasks';
import { UserViewService, userViewInclude } from '../users/user-view.service';
import { chatRoom, RealtimeService, sosRoom, userRoom } from './realtime.service';

export const REALTIME_NAMESPACE = '/rt';

export type SocketData = { userId: string };

/** Client → server events per socket: burst and sustained rate per second. */
export const EVENT_BURST = 20;
export const EVENT_RATE = 20;
export const MAX_SOCKETS_PER_USER = 10;

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
    private readonly redis: RedisService,
    private readonly userView: UserViewService,
    private readonly tasks: BackgroundTasks,
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
    if (sub) await closeRedis(sub);
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
    const [chatIds, sosIds] = await Promise.all([this.chatIdsOf(claims.sub), this.openSosIdsOf(claims.sub)]);
    await socket.join([userRoom(claims.sub), ...chatIds.map(chatRoom), ...sosIds.map(sosRoom)]);
    // A membership revoked between the query and the join must not stick (see also onConnection).
    await this.pruneRooms(socket, claims.sub);
    // A revocation published between the first check and the join would have missed this socket: check again.
    const after = await this.userState.getForAuth(claims.sub);
    const revoked = after.revokedBeforeMs !== null && claims.issuedAtMs <= after.revokedBeforeMs;
    if (!after.state || revoked || isUserBlocked(after.state)) {
      for (const room of [...socket.rooms]) if (room !== socket.id) await socket.leave(room);
      throw unauthorized(after.state && isUserBlocked(after.state) ? 'ACCOUNT_BLOCKED' : 'UNAUTHORIZED');
    }
  }

  /** Chats the user may read: membership, and for community chats a live (non-deleted) community. */
  private async chatIdsOf(userId: string, onlyChatId?: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT c.id FROM chat_members cm
      JOIN chats c ON c.id = cm.chat_id
      LEFT JOIN communities com ON c.type = 'community' AND com.id = CASE WHEN c.type = 'community' THEN c.ref_id::uuid END
      WHERE cm.user_id = ${userId}::uuid
        AND (c.type <> 'community' OR com.deleted_at IS NULL)
        ${onlyChatId ? Prisma.sql`AND c.id = ${onlyChatId}::uuid` : Prisma.empty}`;
    return rows.map((r) => r.id);
  }

  /** Open SOS the user requested, responded to or was dispatched for. */
  private async openSosIdsOf(userId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT s.id FROM sos_requests s
      WHERE s.status IN ('created', 'accepted', 'in_progress') AND (
        s.user_id = ${userId}::uuid
        OR EXISTS (SELECT 1 FROM sos_responses r WHERE r.sos_id = s.id AND r.helper_id = ${userId}::uuid)
        OR EXISTS (SELECT 1 FROM sos_dispatches d WHERE d.sos_id = s.id AND d.user_id = ${userId}::uuid))`;
    return rows.map((r) => r.id);
  }

  /** Leaves every chat/sos room the user is no longer allowed in (re-check after a join). */
  private async pruneRooms(socket: Socket, userId: string): Promise<void> {
    const [chatIds, sosIds] = await Promise.all([this.chatIdsOf(userId), this.openSosIdsOf(userId)]);
    const allowed = new Set([...chatIds.map(chatRoom), ...sosIds.map(sosRoom)]);
    for (const room of [...socket.rooms]) {
      if ((room.startsWith('chat:') || room.startsWith('sos:')) && !allowed.has(room)) await socket.leave(room);
    }
  }

  private registerChatHandlers(socket: Socket, userId: string): void {
    socket.on('chat:join', (payload: unknown, ack?: unknown) => {
      const reply = typeof ack === 'function' ? (ack as (r: { ok: boolean }) => void) : () => undefined;
      const parsed = chatRefSchema.safeParse(payload);
      if (!parsed.success) return reply({ ok: false });
      const room = chatRoom(parsed.data.chatId);
      // The socket's rooms are the cache of allowed chats: membership grants join them, revocations leave them.
      if (socket.rooms.has(room)) return reply({ ok: true });
      this.tasks.run('chat:join', async () => {
        try {
          if (!(await this.chatIdsOf(userId, parsed.data.chatId)).length) return reply({ ok: false });
          await socket.join(room);
          // Re-check after joining: a removal that raced the check must not leave us in the room.
          if (!(await this.chatIdsOf(userId, parsed.data.chatId)).length) {
            await socket.leave(room);
            return reply({ ok: false });
          }
          reply({ ok: true });
        } catch (err) {
          reply({ ok: false });
          throw err;
        }
      });
    });
    socket.on('chat:leave', (payload: unknown) => {
      const parsed = chatRefSchema.safeParse(payload);
      if (parsed.success) void socket.leave(chatRoom(parsed.data.chatId));
    });
    socket.on('chat:typing', (payload: unknown) => {
      const parsed = chatRefSchema.safeParse(payload);
      // Room membership mirrors chat membership (joined on connect / grant, left on revoke).
      if (!parsed.success || !socket.rooms.has(chatRoom(parsed.data.chatId))) return;
      this.tasks.run('chat:typing', () => this.relayTyping(userId, parsed.data.chatId));
    });
  }

  /** At most one `chat:typing` per user per chat every CHAT_LIMITS.typingThrottleMs, across instances. */
  private async relayTyping(userId: string, chatId: string): Promise<void> {
    const first = await this.redis.set(`typing:${chatId}:${userId}`, '1', 'PX', CHAT_LIMITS.typingThrottleMs, 'NX');
    if (first !== 'OK') return;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: userViewInclude });
    if (!user) return;
    this.realtime.emitToChatExcept(chatId, userId, 'chat:typing', { chatId, user: this.userView.toMini(user) });
  }

  /** Sends the current unread count so the badge is right after (re)connecting. */
  private onConnection(socket: Socket): void {
    const { userId } = socket.data as SocketData;
    this.limitEventRate(socket);
    this.registerChatHandlers(socket, userId);
    // Rooms were joined in the auth middleware, but until `connection` the socket isn't in the namespace's
    // socket map, so a `socketsLeave` issued by a membership revocation in that window skipped it. Any such
    // revocation committed before this point, so one more check now closes the gap; later ones reach it.
    this.tasks.run('Prune rooms after connect', () => this.pruneRooms(socket, userId));
    this.tasks.run('Socket limit per user', () => this.enforceSocketLimit(userId));
    this.tasks.run('Initial notification:count', async () => {
      const count = await this.prisma.notification.count({ where: { userId, readAt: null } });
      socket.emit('notification:count', { count });
    });
  }

  /**
   * Token bucket per socket for client → server events: bursts up to EVENT_BURST, refilled EVENT_RATE per
   * second. A client that exceeds it is disconnected (flooding chat:join / chat:typing).
   */
  private limitEventRate(socket: Socket): void {
    let tokens = EVENT_BURST;
    let last = Date.now();
    socket.use((_packet, next) => {
      const now = Date.now();
      tokens = Math.min(EVENT_BURST, tokens + ((now - last) / 1000) * EVENT_RATE);
      last = now;
      if (tokens < 1) {
        this.logger.warn({ userId: (socket.data as SocketData).userId }, 'Socket event flood, disconnecting');
        socket.disconnect(true);
        return;
      }
      tokens -= 1;
      next();
    });
  }

  /** At most MAX_SOCKETS_PER_USER sockets per user across instances; the oldest ones are disconnected. */
  private async enforceSocketLimit(userId: string): Promise<void> {
    const sockets = await this.ns.in(userRoom(userId)).fetchSockets();
    if (sockets.length <= MAX_SOCKETS_PER_USER) return;
    const oldestFirst = [...sockets].sort((a, b) => a.handshake.issued - b.handshake.issued);
    for (const s of oldestFirst.slice(0, sockets.length - MAX_SOCKETS_PER_USER)) s.disconnect(true);
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
