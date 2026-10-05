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

  /** Relations of several viewers to several users in one query: viewerId → (userId → relation). */
  async relationsForMany(viewerIds: string[], userIds: string[]): Promise<Map<string, Map<string, Relation>>> {
    const out = new Map<string, Map<string, Relation>>();
    const keys = new Set<string>();
    for (const v of viewerIds) {
      const m = new Map<string, Relation>();
      for (const u of userIds) {
        m.set(u, u === v ? 'self' : 'none');
        if (u !== v) keys.add(friendPairKey(v, u));
      }
      out.set(v, m);
    }
    if (!keys.size) return out;
    const rows = await this.prisma.friendship.findMany({
      where: { pairKey: { in: [...keys] } },
      select: { requesterId: true, addresseeId: true, status: true },
    });
    for (const f of rows) {
      for (const [viewer, other] of [[f.requesterId, f.addresseeId], [f.addresseeId, f.requesterId]] as const) {
        const m = out.get(viewer);
        if (!m?.has(other)) continue;
        m.set(other, f.status === 'accepted' ? 'friend' : viewer === f.requesterId ? 'request_out' : 'request_in');
      }
    }
    return out;
  }

  async relationFor(viewerId: string, userId: string): Promise<Relation> {
    return (await this.relationsFor(viewerId, [userId])).get(userId) ?? 'none';
  }
}
