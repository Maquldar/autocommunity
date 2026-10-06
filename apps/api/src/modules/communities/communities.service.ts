import { Injectable } from '@nestjs/common';
import { Prisma, type Community, type CommunityMember } from '@prisma/client';
import {
  communityNameKey,
  COMMUNITY_LIMITS,
  type CommunitiesQuery,
  type CommunityDto,
  type CommunityMemberDto,
  type CommunityRole,
  type CreateCommunityInput,
  type MembershipStatus,
  type Paginated,
  type UpdateCommunityInput,
} from '@autoc/shared';
import { Errors } from '../../common/errors/api-exception';
import { newId } from '../../common/ids';
import { decodeCursor, splitPage } from '../../common/pagination/cursor';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Storage } from '../../infra/storage/storage';
import { ChatsService } from '../chats/chats.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';
import { UserViewService, userViewInclude } from '../users/user-view.service';
import { decodeListCursor, encodeListCursor, type ListCursor } from './list-cursor';

type Tx = Prisma.TransactionClient;
type CommunityWithAvatar = Community & { avatar: { key: string; thumbKey: string | null } | null };
type Membership = Pick<CommunityMember, 'role' | 'status'>;

const isMod = (m: Membership | null | undefined): boolean => !!m && m.status === 'active' && (m.role === 'owner' || m.role === 'moderator');
const isActive = (m: Membership | null | undefined): boolean => !!m && m.status === 'active';

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
const nameTaken = () => Errors.conflict('COMMUNITY_NAME_TAKEN', 'A community with this name already exists');
const notFound = () => Errors.notFound('Community not found');

@Injectable()
export class CommunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: Storage,
    private readonly userView: UserViewService,
    private readonly uploads: UploadsService,
    private readonly chats: ChatsService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ------------------------------------------------------------------ queries */

  /** Ordered by memberCount desc, name, id (keyset). `q` matches a name substring (prefix included). */
  async list(viewerId: string, query: CommunitiesQuery): Promise<Paginated<CommunityDto>> {
    const after = decodeListCursor(query.cursor);
    const q = query.q?.toLowerCase();
    const rows = await this.prisma.$queryRaw<ListCursor[]>`
      SELECT c.id, c.member_count AS "memberCount", c.name
      FROM communities c
      WHERE c.deleted_at IS NULL
        ${q ? Prisma.sql`AND lower(c.name) LIKE ${`%${q.replace(/[\\%_]/g, '\\$&')}%`} ESCAPE '\\'` : Prisma.empty}
        ${query.city ? Prisma.sql`AND c.city = ${query.city}` : Prisma.empty}
        ${query.mine ? Prisma.sql`AND EXISTS (SELECT 1 FROM community_members m WHERE m.community_id = c.id AND m.user_id = ${viewerId}::uuid)` : Prisma.empty}
        ${
          after
            ? Prisma.sql`AND (c.member_count < ${after.memberCount}::int
                OR (c.member_count = ${after.memberCount}::int AND (c.name, c.id) > (${after.name}, ${after.id}::uuid)))`
            : Prisma.empty
        }
      ORDER BY c.member_count DESC, c.name ASC, c.id ASC
      LIMIT ${query.limit + 1}::int`;
    const hasMore = rows.length > query.limit;
    const pageRows = rows.slice(0, query.limit);
    const communities = await this.prisma.community.findMany({ where: { id: { in: pageRows.map((r) => r.id) } }, include: avatarInclude });
    const byId = new Map(communities.map((c) => [c.id, c]));
    const ordered = pageRows.map((r) => byId.get(r.id)).filter((c): c is CommunityWithAvatar => !!c);
    const last = pageRows[pageRows.length - 1];
    return { items: await this.toDtos(viewerId, ordered), nextCursor: hasMore && last ? encodeListCursor(last) : null };
  }

  async get(viewerId: string, id: string): Promise<CommunityDto> {
    return (await this.toDtos(viewerId, [await this.requireLive(id)]))[0]!;
  }

  /** Active members are public for public communities and visible to active members of private ones; pending → mods only. */
  async members(viewerId: string, id: string, status: MembershipStatus, cursor: string | undefined, limit: number): Promise<Paginated<CommunityMemberDto>> {
    const community = await this.requireLive(id);
    const mine = await this.membershipOf(id, viewerId);
    if (status === 'pending' && !isMod(mine)) throw Errors.forbidden('Only moderators can see join requests');
    if (status === 'active' && community.isPrivate && !isActive(mine)) throw Errors.forbidden('Members of a private community are visible to its members only');
    const after = decodeCursor(cursor);
    const rows = await this.prisma.communityMember.findMany({
      where: {
        communityId: id,
        status,
        ...(after ? { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, userId: { lt: after.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { userId: 'desc' }],
      take: limit + 1,
      include: { user: { include: userViewInclude } },
    });
    const page = splitPage(rows, limit, (r) => ({ createdAt: r.createdAt, id: r.userId }));
    const users = await this.userView.toPublicMany(viewerId, page.rows.map((r) => r.user));
    return {
      items: page.rows.map((r, i) => ({
        user: users[i]!,
        role: r.role,
        status: r.status,
        joinedAt: r.joinedAt?.toISOString() ?? null,
        requestedAt: r.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  /* ------------------------------------------------------------------ community lifecycle */

  async create(userId: string, input: CreateCommunityInput): Promise<CommunityDto> {
    if (input.avatarUploadId) await this.uploads.requireOwn(userId, input.avatarUploadId, ['community']);
    const id = newId();
    const chatId = newId();
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const owned = await tx.community.count({ where: { ownerId: userId, deletedAt: null } });
        if (owned >= COMMUNITY_LIMITS.ownedPerUser) throw Errors.conflict('COMMUNITY_LIMIT', `You can own at most ${COMMUNITY_LIMITS.ownedPerUser} communities`);
        await this.assertMembershipRoom(tx, userId);
        await this.assertNameFree(tx, input.name);
        if (input.avatarUploadId) await assertAvatarFree(tx, input.avatarUploadId);
        const now = new Date();
        await tx.community.create({
          data: {
            id,
            name: input.name,
            nameKey: communityNameKey(input.name),
            description: input.description,
            city: input.city ?? null,
            isPrivate: input.isPrivate,
            ownerId: userId,
            avatarUploadId: input.avatarUploadId ?? null,
            memberCount: 1,
            members: { create: { userId, role: 'owner', status: 'active', joinedAt: now } },
          },
        });
        await tx.chat.create({ data: { id: chatId, type: 'community', refId: id, members: { create: { userId } } } });
      });
    } catch (err) {
      throw uniqueToApiError(err);
    }
    this.chats.granted(chatId, [userId]);
    return this.get(userId, id);
  }

  /** Owner: every field. Moderators: name, description and avatar. */
  async update(userId: string, id: string, input: UpdateCommunityInput): Promise<CommunityDto> {
    if (input.avatarUploadId) await this.uploads.requireOwn(userId, input.avatarUploadId, ['community']);
    let previousAvatar: string | null = null;
    try {
      await this.prisma.$transaction(async (tx) => {
        const community = await lockCommunity(tx, id);
        const mine = await membership(tx, id, userId);
        if (!isMod(mine)) throw Errors.forbidden('Only the owner and moderators can edit the community');
        if (mine!.role !== 'owner' && (input.city !== undefined || input.isPrivate !== undefined)) {
          throw Errors.forbidden('Only the owner can change the city or privacy');
        }
        if (input.avatarUploadId && input.avatarUploadId !== community.avatarUploadId) await assertAvatarFree(tx, input.avatarUploadId);
        const nameKey = input.name !== undefined ? communityNameKey(input.name) : undefined;
        if (nameKey !== undefined && nameKey !== community.nameKey) await this.assertNameFree(tx, input.name!);
        await tx.community.update({
          where: { id },
          data: { name: input.name, nameKey, description: input.description, city: input.city, isPrivate: input.isPrivate, avatarUploadId: input.avatarUploadId },
        });
        if (input.avatarUploadId !== undefined && input.avatarUploadId !== community.avatarUploadId) previousAvatar = community.avatarUploadId;
      });
    } catch (err) {
      throw uniqueToApiError(err);
    }
    if (previousAvatar) await this.uploads.remove(previousAvatar);
    return this.get(userId, id);
  }

  /** Soft delete: hidden from lists, chat access revoked for everyone; the name becomes free again. */
  /**
   * Soft delete: hidden from lists, chat access revoked for everyone (community chat and every event
   * chat; event participations are dropped); the name becomes free again. `inTx` runs inside the same
   * transaction (admin audit rows).
   */
  async remove(userId: string, id: string, opts: { asAdmin?: boolean; inTx?: (tx: Tx) => Promise<void> } = {}): Promise<void> {
    const after = await this.prisma.$transaction(async (tx) => {
      const done = await this.removeTx(tx, userId, id, opts);
      if (opts.inTx) await opts.inTx(tx);
      return done;
    });
    after();
  }

  /** `remove` inside the caller's transaction; returns the after-commit step (socket rooms, chat lists). */
  async removeTx(tx: Tx, userId: string, id: string, opts: { asAdmin?: boolean } = {}): Promise<() => void> {
    const community = await lockCommunity(tx, id);
    if (community.ownerId !== userId && !opts.asAdmin) throw Errors.forbidden('Only the owner can delete the community');
    await tx.community.update({ where: { id }, data: { deletedAt: new Date() } });
    const chat = await tx.chat.findUnique({ where: { refId: id }, select: { id: true, members: { select: { userId: true } } } });
    if (chat) await tx.chatMember.deleteMany({ where: { chatId: chat.id } });
    const events = await dropEventParticipation(tx, id, null);
    const revocations = [...(chat ? [{ chatId: chat.id, userIds: chat.members.map((m) => m.userId) }] : []), ...events];
    return () => {
      for (const r of revocations) this.chats.revoked(r.chatId, r.userIds);
    };
  }

  /* ------------------------------------------------------------------ membership
   * Every membership change locks the community row first (then, where needed, user rows), and re-reads
   * the actor's and target's memberships under that lock — one lock order everywhere, so concurrent
   * transfer / leave / remove can't interleave into an ownerless community or a wrong memberCount. */

  async join(userId: string, id: string): Promise<{ status: MembershipStatus }> {
    let result: { status: MembershipStatus; chatId: string | null; community: Community };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const community = await lockCommunity(tx, id);
        await lockUser(tx, userId);
        if (await membership(tx, id, userId)) throw alreadyMember();
        await this.assertMembershipRoom(tx, userId);
        if (community.isPrivate) {
          await tx.communityMember.create({ data: { communityId: id, userId, role: 'member', status: 'pending' } });
          return { status: 'pending' as const, chatId: null, community };
        }
        await tx.communityMember.create({ data: { communityId: id, userId, role: 'member', status: 'active', joinedAt: new Date() } });
        const chatId = await this.activate(tx, id, [userId]);
        return { status: 'active' as const, chatId, community };
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw alreadyMember();
      throw err;
    }
    if (result.chatId) this.chats.granted(result.chatId, [userId]);
    if (result.status === 'pending') await this.notifyRequest(result.community, userId);
    return { status: result.status };
  }

  /** Leaving (or cancelling a pending request). The owner must transfer ownership or delete instead. */
  async leave(userId: string, id: string): Promise<void> {
    const revocations = await this.prisma.$transaction(async (tx) => {
      await lockCommunity(tx, id);
      const m = await membership(tx, id, userId);
      if (!m) throw Errors.notFound('You are not a member of this community');
      if (m.role === 'owner') throw Errors.badRequest('OWNER_CANNOT_LEAVE', 'Transfer ownership or delete the community first');
      return this.dropMember(tx, id, userId);
    });
    for (const r of revocations) this.chats.revoked(r.chatId, r.userIds);
  }

  async approve(actorId: string, id: string, targetId: string): Promise<void> {
    const { chatId, community } = await this.prisma.$transaction(async (tx) => {
      const community = await lockCommunity(tx, id);
      if (!isMod(await membership(tx, id, actorId))) throw Errors.forbidden('Only the owner and moderators can do this');
      const target = await membership(tx, id, targetId);
      if (target?.status !== 'pending') throw Errors.notFound('Join request not found');
      await tx.communityMember.update({ where: { communityId_userId: { communityId: id, userId: targetId } }, data: { status: 'active', joinedAt: new Date() } });
      return { chatId: await this.activate(tx, id, [targetId]), community };
    });
    this.chats.granted(chatId, [targetId]);
    await this.notifications.create(targetId, 'community_approved', { communityId: id, communityName: community.name });
  }

  /** Deletes the pending request without notifying the requester. */
  async reject(actorId: string, id: string, targetId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockCommunity(tx, id);
      if (!isMod(await membership(tx, id, actorId))) throw Errors.forbidden('Only the owner and moderators can do this');
      const { count } = await tx.communityMember.deleteMany({ where: { communityId: id, userId: targetId, status: 'pending' } });
      if (!count) throw Errors.notFound('Join request not found');
    });
  }

  /**
   * Owner only. `moderator` / `member` promote or demote an active member; `owner` transfers ownership and
   * the previous owner becomes a moderator.
   */
  async setRole(actorId: string, id: string, targetId: string, role: CommunityRole): Promise<void> {
    const result = await this.prisma.$transaction(async (tx) => {
      const community = await lockCommunity(tx, id);
      if (community.ownerId !== actorId) throw Errors.forbidden('Only the owner can change roles');
      if (targetId === actorId) throw Errors.badRequest('INVALID_TARGET', "You can't change your own role");
      const target = await membership(tx, id, targetId);
      if (!target || target.status !== 'active') throw Errors.notFound('Member not found');
      if (target.role === role) return null;
      if (role === 'owner') {
        await lockUser(tx, targetId);
        const owned = await tx.community.count({ where: { ownerId: targetId, deletedAt: null } });
        if (owned >= COMMUNITY_LIMITS.ownedPerUser) throw Errors.conflict('COMMUNITY_LIMIT', 'The new owner already owns the maximum number of communities');
        await tx.community.update({ where: { id }, data: { ownerId: targetId } });
        await tx.communityMember.update({ where: { communityId_userId: { communityId: id, userId: actorId } }, data: { role: 'moderator' } });
      }
      await tx.communityMember.update({ where: { communityId_userId: { communityId: id, userId: targetId } }, data: { role } });
      return community;
    });
    if (!result) return;
    await this.notifications.create(targetId, 'community_role', { communityId: id, communityName: result.name, role });
  }

  /** Moderators remove members (active or pending); only the owner can remove moderators; nobody removes the owner. */
  async removeMember(actorId: string, id: string, targetId: string): Promise<void> {
    const revocations = await this.prisma.$transaction(async (tx) => {
      await lockCommunity(tx, id);
      const actor = await membership(tx, id, actorId);
      if (!isMod(actor)) throw Errors.forbidden('Only the owner and moderators can remove members');
      if (targetId === actorId) throw Errors.badRequest('INVALID_TARGET', 'Use leave to leave the community');
      const target = await membership(tx, id, targetId);
      if (!target) throw Errors.notFound('Member not found');
      if (target.role === 'owner') throw Errors.forbidden("The owner can't be removed");
      if (target.role === 'moderator' && actor!.role !== 'owner') throw Errors.forbidden('Only the owner can remove moderators');
      return this.dropMember(tx, id, targetId);
    });
    for (const r of revocations) this.chats.revoked(r.chatId, r.userIds);
  }

  /* ------------------------------------------------------------------ helpers */

  /** Increments memberCount and adds chat membership for newly active members; returns the chat id. */
  private async activate(tx: Tx, communityId: string, userIds: string[]): Promise<string> {
    await tx.community.update({ where: { id: communityId }, data: { memberCount: { increment: userIds.length } } });
    const chat = await tx.chat.findUniqueOrThrow({ where: { refId: communityId }, select: { id: true } });
    await this.chats.addMembers(tx, chat.id, userIds);
    return chat.id;
  }

  /**
   * Deletes the membership row; for an active one also decrements memberCount and leaves the community
   * chat. The user's RSVPs to the community's events go too (and with them the event chats). Returns the
   * chats whose access was revoked (call `chats.revoked` for each after commit).
   */
  private async dropMember(tx: Tx, communityId: string, userId: string): Promise<Revocation[]> {
    const deleted = await tx.communityMember.deleteMany({ where: { communityId, userId, status: 'active' } });
    if (!deleted.count) {
      const pending = await tx.communityMember.deleteMany({ where: { communityId, userId, status: 'pending' } });
      if (!pending.count) throw Errors.notFound('Member not found');
      return dropEventParticipation(tx, communityId, [userId]);
    }
    await tx.community.update({ where: { id: communityId }, data: { memberCount: { decrement: 1 } } });
    const chat = await tx.chat.findUnique({ where: { refId: communityId }, select: { id: true } });
    if (chat) await this.chats.removeMembers(tx, chat.id, [userId]);
    const events = await dropEventParticipation(tx, communityId, [userId]);
    return [...(chat ? [{ chatId: chat.id, userIds: [userId] }] : []), ...events];
  }

  private async assertMembershipRoom(tx: Tx, userId: string): Promise<void> {
    const count = await tx.communityMember.count({ where: { userId, community: { deletedAt: null } } });
    if (count >= COMMUNITY_LIMITS.membershipsPerUser) {
      throw Errors.conflict('MEMBERSHIP_LIMIT', `You can belong to at most ${COMMUNITY_LIMITS.membershipsPerUser} communities`);
    }
  }

  private async assertNameFree(tx: Tx, name: string): Promise<void> {
    const taken = await tx.community.findFirst({ where: { deletedAt: null, nameKey: communityNameKey(name) }, select: { id: true } });
    if (taken) throw nameTaken();
  }

  private async notifyRequest(community: Community, userId: string): Promise<void> {
    const [user, mods] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: userViewInclude }),
      this.prisma.communityMember.findMany({
        where: { communityId: community.id, status: 'active', role: { in: ['owner', 'moderator'] } },
        select: { userId: true },
      }),
    ]);
    const payload = { communityId: community.id, communityName: community.name, user: this.userView.toMini(user) };
    for (const m of mods) await this.notifications.create(m.userId, 'community_request', payload);
  }

  private async requireLive(id: string): Promise<CommunityWithAvatar> {
    const c = await this.prisma.community.findFirst({ where: { id, deletedAt: null }, include: avatarInclude });
    if (!c) throw notFound();
    return c;
  }

  private membershipOf(communityId: string, userId: string): Promise<Membership | null> {
    return this.prisma.communityMember.findUnique({ where: { communityId_userId: { communityId, userId } }, select: { role: true, status: true } });
  }

  /** Viewer memberships and chat ids for the whole page in two queries. */
  private async toDtos(viewerId: string, communities: CommunityWithAvatar[]): Promise<CommunityDto[]> {
    if (!communities.length) return [];
    const ids = communities.map((c) => c.id);
    const [memberships, chats] = await Promise.all([
      this.prisma.communityMember.findMany({ where: { userId: viewerId, communityId: { in: ids } }, select: { communityId: true, role: true, status: true } }),
      this.prisma.chat.findMany({ where: { refId: { in: ids } }, select: { id: true, refId: true } }),
    ]);
    const mine = new Map(memberships.map((m) => [m.communityId, m]));
    const chatByCommunity = new Map(chats.map((c) => [c.refId, c.id]));
    return communities.map((c) => {
      const m = mine.get(c.id);
      const key = c.avatar ? (c.avatar.thumbKey ?? c.avatar.key) : null;
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        city: c.city,
        avatarUrl: key ? this.storage.publicUrl(key) : null,
        isPrivate: c.isPrivate,
        memberCount: c.memberCount,
        ownerId: c.ownerId,
        chatId: m?.status === 'active' ? (chatByCommunity.get(c.id) ?? null) : null,
        myMembership: m ? { role: m.role, status: m.status } : null,
        createdAt: c.createdAt.toISOString(),
      };
    });
  }
}

type Revocation = { chatId: string; userIds: string[] };

/**
 * Removes RSVPs of `userIds` (every participant when null) to the community's events, keeps goingCount
 * right and removes those users from the event chats. The events are locked first (same order as RSVP,
 * which locks the event row before re-checking visibility), so a concurrent RSVP can't slip back in.
 */
async function dropEventParticipation(tx: Tx, communityId: string, userIds: string[] | null): Promise<Revocation[]> {
  const events = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM events WHERE community_id = ${communityId}::uuid ORDER BY id FOR UPDATE`;
  if (!events.length) return [];
  const eventIds = events.map((e) => e.id);
  const userFilter = userIds ? { userId: { in: userIds } } : {};
  const removed = await tx.eventParticipant.findMany({ where: { eventId: { in: eventIds }, ...userFilter }, select: { eventId: true } });
  if (removed.length) {
    await tx.eventParticipant.deleteMany({ where: { eventId: { in: eventIds }, ...userFilter } });
    const touched = [...new Set(removed.map((r) => r.eventId))];
    await tx.$executeRaw`
      UPDATE events e SET going_count = (SELECT count(*)::int FROM event_participants p WHERE p.event_id = e.id AND p.status = 'going')
      WHERE e.id = ANY(${touched}::uuid[])`;
  }
  const chats = await tx.chat.findMany({
    where: { type: 'event', refId: { in: eventIds } },
    select: { id: true, members: { where: userIds ? { userId: { in: userIds } } : {}, select: { userId: true } } },
  });
  const revocations: Revocation[] = [];
  for (const chat of chats) {
    if (!chat.members.length) continue;
    const members = chat.members.map((m) => m.userId);
    await tx.chatMember.deleteMany({ where: { chatId: chat.id, userId: { in: members } } });
    revocations.push({ chatId: chat.id, userIds: members });
  }
  return revocations;
}

const avatarInclude = { avatar: { select: { key: true, thumbKey: true } } } satisfies Prisma.CommunityInclude;

const alreadyMember = () => Errors.conflict('ALREADY_MEMBER', 'You are already a member or have a pending request');

/** First step of every membership mutation: the community row lock (404 if missing or deleted). */
async function lockCommunity(tx: Tx, id: string): Promise<Community> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM communities WHERE id = ${id}::uuid AND deleted_at IS NULL FOR UPDATE`;
  if (!rows[0]) throw notFound();
  return tx.community.findUniqueOrThrow({ where: { id } });
}

const membership = (tx: Tx, communityId: string, userId: string): Promise<Membership | null> =>
  tx.communityMember.findUnique({ where: { communityId_userId: { communityId, userId } }, select: { role: true, status: true } });

/** A community avatar upload can belong to one community only (also enforced by a unique index). */
async function assertAvatarFree(tx: Tx, uploadId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM uploads WHERE id = ${uploadId}::uuid FOR UPDATE`;
  if (await tx.community.count({ where: { avatarUploadId: uploadId } })) throw uploadInUse();
}

const uploadInUse = () => Errors.badRequest('INVALID_UPLOAD', 'This upload is already used elsewhere');

/** Unique violations from create/update: the avatar index → INVALID_UPLOAD, the name index → NAME_TAKEN. */
function uniqueToApiError(err: unknown): unknown {
  if (!isUniqueViolation(err)) return err;
  return JSON.stringify((err as Prisma.PrismaClientKnownRequestError).meta ?? {}).includes('avatar') ? uploadInUse() : nameTaken();
}

/** Serializes one user's membership changes so the per-user limits can't be raced past. */
async function lockUser(tx: Tx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
}

