import { Injectable } from '@nestjs/common';
import type { ServerToClientEvents } from '@autoc/shared';
import type { Namespace } from 'socket.io';

export const userRoom = (userId: string) => `user:${userId}`;
export const chatRoom = (chatId: string) => `chat:${chatId}`;
export const sosRoom = (sosId: string) => `sos:${sosId}`;

type Args<E extends keyof ServerToClientEvents> = Parameters<ServerToClientEvents[E]>;

/**
 * Emits server → client events and manages chat-room membership of users' sockets. Through the Redis
 * adapter both reach sockets on every API instance. Calls before the gateway is initialised (or in
 * processes without one) are no-ops: realtime is best-effort, the database is the source of truth.
 */
@Injectable()
export class RealtimeService {
  private ns: Namespace | null = null;

  attach(ns: Namespace): void {
    this.ns = ns;
  }

  emitToUser<E extends keyof ServerToClientEvents>(userId: string, event: E, ...args: Args<E>): void {
    this.ns?.to(userRoom(userId)).emit(event, ...args);
  }

  emitToUsers<E extends keyof ServerToClientEvents>(userIds: string[], event: E, ...args: Args<E>): void {
    if (!this.ns || !userIds.length) return;
    this.ns.to(userIds.map(userRoom)).emit(event, ...args);
  }

  emitToChat<E extends keyof ServerToClientEvents>(chatId: string, event: E, ...args: Args<E>): void {
    this.ns?.to(chatRoom(chatId)).emit(event, ...args);
  }

  /** To everyone in the chat room except every socket of `userId` (e.g. typing, never to self). */
  emitToChatExcept<E extends keyof ServerToClientEvents>(chatId: string, userId: string, event: E, ...args: Args<E>): void {
    this.ns?.to(chatRoom(chatId)).except(userRoom(userId)).emit(event, ...args);
  }

  /** Puts every connected socket of these users into the chat room (membership granted). */
  joinChat(userIds: string[], chatId: string): void {
    if (this.ns && userIds.length) this.ns.in(userIds.map(userRoom)).socketsJoin(chatRoom(chatId));
  }

  /** Removes every connected socket of these users from the chat room (membership revoked). */
  leaveChat(userIds: string[], chatId: string): void {
    if (this.ns && userIds.length) this.ns.in(userIds.map(userRoom)).socketsLeave(chatRoom(chatId));
  }

  /** Puts every connected socket of these users into an arbitrary room (e.g. `sos:{id}`). */
  joinRoom(userIds: string[], room: string): void {
    if (this.ns && userIds.length) this.ns.in(userIds.map(userRoom)).socketsJoin(room);
  }

  /** Whether any socket of the user (on any instance) is in the chat room right now. */
  async isUserInChat(userId: string, chatId: string): Promise<boolean> {
    if (!this.ns) return false;
    const sockets = await this.ns.in(userRoom(userId)).fetchSockets();
    return sockets.some((s) => s.rooms.has(chatRoom(chatId)));
  }
}
