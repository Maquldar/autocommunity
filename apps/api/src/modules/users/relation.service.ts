import { Injectable } from '@nestjs/common';
import type { Relation } from '@autoc/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** One friendship row per pair regardless of direction (see Friendship.pairKey). */
export const friendPairKey = (a: string, b: string): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

@Injectable()
export class RelationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Viewer's relation to each user, loaded with a single query. */
  async relationsFor(viewerId: string, userIds: string[]): Promise<Map<string, Relation>> {
    const result = new Map<string, Relation>();
    const others = [...new Set(userIds)].filter((id) => {
      if (id === viewerId) result.set(id, 'self');
      return id !== viewerId;
    });
    for (const id of others) result.set(id, 'none');
    if (!others.length) return result;

    const rows = await this.prisma.friendship.findMany({
      where: { pairKey: { in: others.map((id) => friendPairKey(viewerId, id)) } },
      select: { requesterId: true, addresseeId: true, status: true },
    });
    for (const f of rows) {
      const other = f.requesterId === viewerId ? f.addresseeId : f.requesterId;
      if (f.status === 'accepted') result.set(other, 'friend');
      else result.set(other, f.requesterId === viewerId ? 'request_out' : 'request_in');
    }
    return result;
  }

  async relationFor(viewerId: string, userId: string): Promise<Relation> {
    return (await this.relationsFor(viewerId, [userId])).get(userId) ?? 'none';
  }
}
