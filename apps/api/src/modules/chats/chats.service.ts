import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CHAT_LIMITS, type ChatDto, type ChatType, type MessageDto, type Paginated, type SendMessageInput, type UserMini } from '@autoc/shared';
import { isUserBlocked } from '../../common/auth/user-state.service';
import { Errors } from '../../common/errors/api-exception';
import { newId } from '../../common/ids';
import { decodeCursor, keysetOrderBy, keysetWhere, splitPage, type CursorKey } from '../../common/pagination/cursor';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RateLimiterService } from '../../infra/rate-limit/rate-limiter.service';
import { Storage } from '../../infra/storage/storage';
import { PushQueue } from '../push/push.queue';
import { RealtimeService } from '../realtime/realtime.service';
import { UploadsService } from '../uploads/uploads.service';
import { friendPairKey } from '../users/relation.service';
import { UserViewService, userViewInclude } from '../users/user-view.service';
import { messagePushPayload } from './message-push';
import { MessageViewService, type MessageRow } from './message-view.service';

type ChatListRow = {
  id: string;
  type: ChatType;
  refId: string;
  lastMessageAt: Date;
  unreadCount: number;
  communityName: string | null;
  communityAvatarKey: string | null;
  communityAvatarThumbKey: string | null;
  peerId: string | null;
  lmId: string | null;
  lmSenderId: string | null;
  lmType: MessageRow['type'] | null;
  lmText: string | null;
  lmUploadId: string | null;
  lmLat: number | null;
  lmLng: number | null;
  lmCreatedAt: Date | null;
  lmDeletedAt: Date | null;
};

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

@Injectable()
export class ChatsService {
  private readonly logger = new Logger(ChatsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessageViewService,
    private readonly userView: UserViewService,
    private readonly uploads: UploadsService,
    private readonly realtime: RealtimeService,
    private readonly rateLimiter: RateLimiterService,
    private readonly push: PushQueue,
    private readonly storage: Storage,
  ) {}

  /* ------------------------------------------------------------------ reading */

  async list(userId: string, cursor: string | undefined, limit: number): Promise<Paginated<ChatDto>> {
    const after = decodeCursor(cursor);
    const rows = await this.queryChats(userId, { after, limit: limit + 1 });
    const page = splitPage(rows, limit, (r) => ({ createdAt: r.lastMessageAt, id: r.id }));
    return { items: await this.toChatDtos(page.rows), nextCursor: page.nextCursor };
  }

  async get(userId: string, chatId: string): Promise<ChatDto> {
    const rows = await this.queryChats(userId, { chatId, limit: 1 });
    if (!rows.length) throw chatNotFound();
    return (await this.toChatDtos(rows))[0]!;
  }

  /** Newest first, keyset on (createdAt, id). */
  async listMessages(userId: string, chatId: string, cursor: string | undefined, limit: number): Promise<Paginated<MessageDto>> {
    await this.requireMember(userId, chatId);
    const after = decodeCursor(cursor);
    const rows = await this.prisma.message.findMany({
      where: { chatId, ...keysetWhere(after) },
      orderBy: keysetOrderBy,
      take: limit + 1,
    });
    const page = splitPage(rows, limit);
    return { items: await this.messages.toDtos(page.rows), nextCursor: page.nextCursor };
  }

  /* ------------------------------------------------------------------ writing */

  async send(userId: string, chatId: string, input: SendMessageInput): Promise<MessageDto> {
    const chat = await this.requireMember(userId, chatId);
    let uploadId: string | null = null;
    if (input.type === 'photo') uploadId = (await this.uploads.requireOwn(userId, input.uploadId, ['message'])).id;
    if (input.type === 'voice') uploadId = (await this.uploads.requireOwn(userId, input.uploadId, ['voice'])).id;
    await this.rateLimiter.consumeOrThrow([{ key: `chat-msg:${userId}`, limit: CHAT_LIMITS.messagesPerMinute, windowSec: 60 }]);

    const createdAt = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          id: newId(),
          chatId,
          senderId: userId,
          type: input.type,
          text: input.type === 'text' ? input.text : input.type === 'photo' ? input.text || null : null,
          uploadId,
          lat: input.type === 'location' ? input.lat : null,
          lng: input.type === 'location' ? input.lng : null,
          createdAt,
        },
      });
      await tx.chat.update({ where: { id: chatId }, data: { lastMessageAt: createdAt } });
      // Your own message never counts as unread for you.
      await tx.chatMember.updateMany({ where: { chatId, userId, lastReadAt: { lt: createdAt } }, data: { lastReadAt: createdAt } });
      return message;
    });
    const dto = await this.messages.toDto(row);
    this.realtime.emitToChat(chatId, 'message:new', dto);
    if (chat.type === 'direct') {
      void this.pushDirect(chatId, userId, dto).catch((err: unknown) => this.logger.warn({ err }, 'Direct message push failed'));
    }
    return dto;
  }

  async markRead(userId: string, chatId: string): Promise<void> {
    await this.requireMember(userId, chatId);
    const lastReadAt = new Date();
    await this.prisma.chatMember.updateMany({ where: { chatId, userId, lastReadAt: { lt: lastReadAt } }, data: { lastReadAt } });
    this.realtime.emitToChat(chatId, 'chat:read', { chatId, userId, lastReadAt: lastReadAt.toISOString() });
  }

  /** The sender, or a moderator/owner of the community for community chats. Idempotent. */
  async deleteMessage(userId: string, chatId: string, messageId: string): Promise<void> {
    const chat = await this.requireMember(userId, chatId);
    const message = await this.prisma.message.findFirst({ where: { id: messageId, chatId } });
    if (!message) throw Errors.notFound('Message not found');
    if (message.senderId !== userId && !(await this.canModerate(userId, chat))) {
      throw Errors.forbidden('Only the sender or a moderator can delete this message');
    }
    if (message.deletedAt) return;
    const { count } = await this.prisma.message.updateMany({ where: { id: messageId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!count) return;
    // The content is gone for everyone: drop the attached file too.
    if (message.uploadId) await this.uploads.remove(message.uploadId).catch((err: unknown) => this.logger.warn({ err }, 'Failed to remove message upload'));
    this.realtime.emitToChat(chatId, 'message:deleted', { chatId, messageId });
  }

  /** Get or create the direct chat with another active, onboarded user. */
  async direct(userId: string, peerId: string): Promise<ChatDto> {
    if (userId === peerId) throw Errors.badRequest('INVALID_TARGET', "You can't message yourself");
    const peer = await this.prisma.user.findUnique({ where: { id: peerId }, select: { status: true, blockedUntil: true, onboardedAt: true } });
    if (!peer || !peer.onboardedAt || isUserBlocked({ status: peer.status, blockedUntil: peer.blockedUntil?.toISOString() ?? null })) {
      throw Errors.notFound('User not found');
    }
    const refId = friendPairKey(userId, peerId);
    let chat = await this.prisma.chat.findUnique({ where: { refId }, select: { id: true } });
    if (!chat) {
      try {
        chat = await this.prisma.chat.create({
          data: { id: newId(), type: 'direct', refId, members: { create: [{ userId }, { userId: peerId }] } },
          select: { id: true },
        });
        this.realtime.joinChat([userId, peerId], chat.id);
        this.realtime.emitToUsers([userId, peerId], 'chats:changed', {});
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        chat = await this.prisma.chat.findUniqueOrThrow({ where: { refId }, select: { id: true } });
      }
    }
    return this.get(userId, chat.id);
  }

  /* ------------------------------------------------------------------ membership (used by communities) */

  /** Adds users to a chat inside the caller's transaction; call `granted` after commit. */
  async addMembers(tx: Prisma.TransactionClient, chatId: string, userIds: string[]): Promise<void> {
    if (userIds.length) await tx.chatMember.createMany({ data: userIds.map((u) => ({ chatId, userId: u })), skipDuplicates: true });
  }

  async removeMembers(tx: Prisma.TransactionClient, chatId: string, userIds: string[]): Promise<void> {
    if (userIds.length) await tx.chatMember.deleteMany({ where: { chatId, userId: { in: userIds } } });
  }

  /** After commit: sockets join the room and the users' chat lists refresh. */
  granted(chatId: string, userIds: string[]): void {
    this.realtime.joinChat(userIds, chatId);
    this.realtime.emitToUsers(userIds, 'chats:changed', {});
  }

  revoked(chatId: string, userIds: string[]): void {
    this.realtime.leaveChat(userIds, chatId);
    this.realtime.emitToUsers(userIds, 'chats:changed', {});
  }

  /* ------------------------------------------------------------------ internals */

  /** 404 unless the user is a member of the chat (and, for community chats, the community is live). */
  private async requireMember(userId: string, chatId: string): Promise<{ id: string; type: ChatType; refId: string }> {
    const rows = await this.prisma.$queryRaw<{ id: string; type: ChatType; refId: string }[]>`
      SELECT c.id, c.type, c.ref_id AS "refId"
      FROM chat_members cm
      JOIN chats c ON c.id = cm.chat_id
      LEFT JOIN communities com ON com.id = CASE WHEN c.type = 'community' THEN c.ref_id::uuid END
      WHERE cm.chat_id = ${chatId}::uuid AND cm.user_id = ${userId}::uuid
        AND (c.type <> 'community' OR com.deleted_at IS NULL)`;
    if (!rows[0]) throw chatNotFound();
    return rows[0];
  }

  private async canModerate(userId: string, chat: { type: ChatType; refId: string }): Promise<boolean> {
    if (chat.type !== 'community') return false;
    const m = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: chat.refId, userId } },
      select: { role: true, status: true },
    });
    return !!m && m.status === 'active' && (m.role === 'owner' || m.role === 'moderator');
  }

  /**
   * The chat list in one statement: last message via LATERAL (index on messages(chat_id, created_at desc)),
   * unread count = others' non-deleted messages after the member's lastReadAt, community name/avatar and
   * the direct-chat peer. Users and uploads for the page are then loaded in one batch each.
   */
  private queryChats(userId: string, opts: { after?: CursorKey | null; chatId?: string; limit: number }): Promise<ChatListRow[]> {
    const me = Prisma.sql`${userId}::uuid`;
    return this.prisma.$queryRaw<ChatListRow[]>`
      SELECT c.id, c.type, c.ref_id AS "refId", c.last_message_at AS "lastMessageAt",
             (SELECT count(*)::int FROM messages um
               WHERE um.chat_id = c.id AND um.created_at > cm.last_read_at AND um.sender_id <> ${me} AND um.deleted_at IS NULL
             ) AS "unreadCount",
             com.name AS "communityName", cu.key AS "communityAvatarKey", cu.thumb_key AS "communityAvatarThumbKey",
             peer.user_id AS "peerId",
             lm.id AS "lmId", lm.sender_id AS "lmSenderId", lm.type AS "lmType", lm.text AS "lmText", lm.upload_id AS "lmUploadId",
             lm.lat AS "lmLat", lm.lng AS "lmLng", lm.created_at AS "lmCreatedAt", lm.deleted_at AS "lmDeletedAt"
      FROM chat_members cm
      JOIN chats c ON c.id = cm.chat_id
      LEFT JOIN communities com ON com.id = CASE WHEN c.type = 'community' THEN c.ref_id::uuid END
      LEFT JOIN uploads cu ON cu.id = com.avatar_upload_id
      LEFT JOIN LATERAL (
        SELECT o.user_id FROM chat_members o WHERE c.type = 'direct' AND o.chat_id = c.id AND o.user_id <> ${me} LIMIT 1
      ) peer ON true
      LEFT JOIN LATERAL (
        SELECT m.* FROM messages m WHERE m.chat_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1
      ) lm ON true
      WHERE cm.user_id = ${me}
        AND (c.type <> 'community' OR com.deleted_at IS NULL)
        ${opts.chatId ? Prisma.sql`AND c.id = ${opts.chatId}::uuid` : Prisma.empty}
        ${opts.after ? Prisma.sql`AND (c.last_message_at, c.id) < (${opts.after.createdAt}, ${opts.after.id}::uuid)` : Prisma.empty}
      ORDER BY c.last_message_at DESC, c.id DESC
      LIMIT ${opts.limit}::int`;
  }

  private async toChatDtos(rows: ChatListRow[]): Promise<ChatDto[]> {
    const peerIds = [...new Set(rows.map((r) => r.peerId).filter((id): id is string => !!id))];
    const lastMessages: MessageRow[] = rows
      .filter((r) => r.lmId)
      .map((r) => ({
        id: r.lmId!,
        chatId: r.id,
        senderId: r.lmSenderId!,
        type: r.lmType!,
        text: r.lmText,
        uploadId: r.lmUploadId,
        lat: r.lmLat,
        lng: r.lmLng,
        createdAt: r.lmCreatedAt!,
        deletedAt: r.lmDeletedAt,
      }));
    const [peers, messageDtos] = await Promise.all([
      peerIds.length ? this.prisma.user.findMany({ where: { id: { in: peerIds } }, include: userViewInclude }) : Promise.resolve([]),
      this.messages.toDtos(lastMessages),
    ]);
    const peerById = new Map<string, UserMini>(peers.map((p) => [p.id, this.userView.toMini(p)]));
    const lastByChat = new Map(messageDtos.map((m) => [m.chatId, m]));
    return rows.map((r) => {
      const peer = r.peerId ? peerById.get(r.peerId) : undefined;
      const base = {
        id: r.id,
        type: r.type,
        refId: r.type === 'direct' ? null : r.refId,
        lastMessage: lastByChat.get(r.id) ?? null,
        unreadCount: r.unreadCount,
      };
      if (r.type === 'direct') {
        return { ...base, title: peer ? peer.name || peer.nickname : '', avatarUrl: peer?.avatarUrl ?? null, ...(peer ? { peer } : {}) };
      }
      const key = r.communityAvatarThumbKey ?? r.communityAvatarKey;
      return { ...base, title: r.communityName ?? '', avatarUrl: key ? this.storage.publicUrl(key) : null };
    });
  }

  /** Web Push to the other participant unless one of their sockets is in the chat room right now. */
  private async pushDirect(chatId: string, senderId: string, message: MessageDto): Promise<void> {
    const recipients = await this.prisma.chatMember.findMany({
      where: { chatId, userId: { not: senderId } },
      select: { user: { select: { id: true, locale: true } } },
    });
    for (const { user } of recipients) {
      if (await this.realtime.isUserInChat(user.id, chatId)) continue;
      await this.push.enqueueForUser(user.id, messagePushPayload(message, user.locale));
    }
  }
}

const chatNotFound = () => Errors.notFound('Chat not found');
