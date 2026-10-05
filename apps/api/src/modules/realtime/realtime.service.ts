import { Injectable } from '@nestjs/common';
import type { ServerToClientEvents } from '@autoc/shared';
import type { Namespace } from 'socket.io';

export const userRoom = (userId: string) => `user:${userId}`;

/**
 * Emits server → client events to a user's sockets. Through the Redis adapter the emit reaches the user's
 * sockets on every API instance. Emits before the gateway is initialised (or in processes without one)
 * are dropped: realtime is best-effort, notifications stay in the DB.
 */
@Injectable()
export class RealtimeService {
  private ns: Namespace | null = null;

  attach(ns: Namespace): void {
    this.ns = ns;
  }

  emitToUser<E extends keyof ServerToClientEvents>(userId: string, event: E, ...args: Parameters<ServerToClientEvents[E]>): void {
    this.ns?.to(userRoom(userId)).emit(event, ...args);
  }

  emitToUsers<E extends keyof ServerToClientEvents>(userIds: string[], event: E, ...args: Parameters<ServerToClientEvents[E]>): void {
    if (!this.ns || !userIds.length) return;
    this.ns.to(userIds.map(userRoom)).emit(event, ...args);
  }
}
