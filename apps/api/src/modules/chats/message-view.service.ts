import { Injectable } from '@nestjs/common';
import type { Message, Upload } from '@prisma/client';
import type { MessageDto, MessageType, UserMini } from '@autoc/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Storage } from '../../infra/storage/storage';
import { toUploadDto } from '../uploads/upload.mapper';
import { UserViewService, userViewInclude } from '../users/user-view.service';

export type MessageRow = Pick<Message, 'id' | 'chatId' | 'senderId' | 'type' | 'text' | 'uploadId' | 'lat' | 'lng' | 'createdAt' | 'deletedAt'>;

/** Renders messages; senders and uploads of a batch are loaded with one query each (no N+1). */
@Injectable()
export class MessageViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userView: UserViewService,
    private readonly storage: Storage,
  ) {}

  async toDtos(rows: MessageRow[]): Promise<MessageDto[]> {
    if (!rows.length) return [];
    const senderIds = [...new Set(rows.map((r) => r.senderId))];
    const uploadIds = [...new Set(rows.filter((r) => r.uploadId && !r.deletedAt).map((r) => r.uploadId!))];
    const [senders, uploads] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: senderIds } }, include: userViewInclude }),
      uploadIds.length ? this.prisma.upload.findMany({ where: { id: { in: uploadIds } } }) : Promise.resolve([] as Upload[]),
    ]);
    const minis = new Map(senders.map((u) => [u.id, this.userView.toMini(u)]));
    const uploadById = new Map(uploads.map((u) => [u.id, u]));
    return rows.map((r) => this.render(r, minis.get(r.senderId) ?? unknownSender(r.senderId), r.uploadId ? uploadById.get(r.uploadId) : undefined));
  }

  async toDto(row: MessageRow): Promise<MessageDto> {
    return (await this.toDtos([row]))[0]!;
  }

  /** Deleted messages keep id/sender/type/time; their content (text, upload, coordinates) is withheld. */
  private render(r: MessageRow, sender: UserMini, upload: Upload | undefined): MessageDto {
    const deleted = r.deletedAt !== null;
    return {
      id: r.id,
      chatId: r.chatId,
      sender,
      type: r.type as MessageType,
      text: deleted ? null : r.text,
      upload: !deleted && upload ? toUploadDto(upload, this.storage) : null,
      lat: deleted ? null : r.lat,
      lng: deleted ? null : r.lng,
      createdAt: r.createdAt.toISOString(),
      deletedAt: r.deletedAt?.toISOString() ?? null,
    };
  }
}

const unknownSender = (id: string): UserMini => ({ id, nickname: '', name: '', avatarUrl: null, rating: 0 });
