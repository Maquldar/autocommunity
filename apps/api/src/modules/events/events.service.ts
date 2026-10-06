import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  EVENT_LIMITS,
  eventTimeIssues,
  type CreateEventInput,
  type EventDto,
  type EventMapResult,
  type EventNotificationPayload,
  type EventParticipantDto,
  type EventsQuery,
  type Bbox,
  type Paginated,
  type RoutePoint,
  type RsvpInput,
  type RsvpStatus,
  type UpdateEventInput,
} from '@autoc/shared';
import { Errors } from '../../common/errors/api-exception';
import { newId } from '../../common/ids';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RateLimiterService } from '../../infra/rate-limit/rate-limiter.service';
import { RedisService } from '../../infra/redis/redis.service';
import { Storage } from '../../infra/storage/storage';
import { BackgroundTasks } from '../../infra/tasks/background-tasks';
import { ChatsService } from '../chats/chats.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UserViewService, userViewInclude } from '../users/user-view.service';
import { EventsQueue, type ReminderJob } from './events.queue';

type Tx = Prisma.TransactionClient;

/** One event row as the viewer sees it (visibility already applied in SQL). */
type EventRow = {
  id: string;
  communityId: string;
  createdById: string;
  title: string;
  description: string;
  place: string;
  lat: number;
  lng: number;
  startsAt: Date;
  endsAt: Date | null;
  route: unknown;
  goingCount: number;
  interestedCount: number;
  myRsvp: RsvpStatus | null;
  myRole: 'owner' | 'moderator' | 'member' | null;
  communityName: string;
  communityPrivate: boolean;
  avatarKey: string | null;
  avatarThumbKey: string | null;
  distanceM: number | null;
};

const notFound = () => Errors.notFound('Event not found');
const DURATION = Prisma.sql`make_interval(hours => ${EVENT_LIMITS.defaultDurationHours}::int)`;
/** The moment an event is over: endsAt, else startsAt + the default duration. */
const ENDS = Prisma.sql`COALESCE(e.ends_at, e.starts_at + ${DURATION})`;

const isMod = (role: string | null | undefined) => role === 'owner' || role === 'moderator';

@Injectable()
export class EventsService implements OnModuleInit {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: Storage,
    private readonly userView: UserViewService,
    private readonly chats: ChatsService,
    private readonly notifications: NotificationsService,
    private readonly queue: EventsQueue,
    private readonly tasks: BackgroundTasks,
    private readonly rateLimiter: RateLimiterService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    this.queue.setHandler((job) => this.remind(job));
  }

  /* ------------------------------------------------------------------ reading */

  /**
   * Upcoming (not ended, startsAt asc) or past (ended, startsAt desc) events the viewer may see: public
   * communities' and the viewer's active communities'. With `communityId`, that community only (403 when
   * it's private and the viewer isn't an active member).
   */
  async list(viewerId: string, query: Pick<EventsQuery, 'scope' | 'communityId' | 'cursor' | 'limit'>): Promise<Paginated<EventDto>> {
    if (query.communityId) await this.assertCommunityVisible(viewerId, query.communityId);
    const after = decodeCursor(query.cursor);
    const upcoming = query.scope === 'upcoming';
    const where = Prisma.sql`
      ${upcoming ? Prisma.sql`${ENDS} > now()` : Prisma.sql`${ENDS} <= now()`}
      ${query.communityId ? Prisma.sql`AND e.community_id = ${query.communityId}::uuid` : Prisma.empty}
      ${
        after
          ? upcoming
            ? Prisma.sql`AND (e.starts_at, e.id) > (${after.createdAt}, ${after.id}::uuid)`
            : Prisma.sql`AND (e.starts_at, e.id) < (${after.createdAt}, ${after.id}::uuid)`
          : Prisma.empty
      }`;
    const order = upcoming ? Prisma.sql`e.starts_at ASC, e.id ASC` : Prisma.sql`e.starts_at DESC, e.id DESC`;
    const rows = await this.query(viewerId, where, order, query.limit + 1);
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return { items: await this.toDtos(viewerId, page), nextCursor: hasMore && last ? encodeCursor({ createdAt: last.startsAt, id: last.id }) : null };
  }

  async get(viewerId: string, id: string): Promise<EventDto> {
    const row = await this.requireVisible(viewerId, id);
    return (await this.toDtos(viewerId, [row]))[0]!;
  }

  /** Going and interested participants (optionally one status), oldest RSVP first. */
  async participants(
    viewerId: string,
    id: string,
    status: RsvpStatus | undefined,
    cursor: string | undefined,
    limit: number,
  ): Promise<Paginated<EventParticipantDto>> {
    await this.requireVisible(viewerId, id);
    const after = decodeCursor(cursor);
    const rows = await this.prisma.eventParticipant.findMany({
      where: {
        eventId: id,
        ...(status ? { status } : {}),
        ...(after ? { OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, userId: { gt: after.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
      take: limit + 1,
      include: { user: { include: userViewInclude } },
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({ user: this.userView.toMini(r.user), status: r.status, createdAt: r.createdAt.toISOString() })),
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.userId }) : null,
    };
  }

  /** Upcoming events (not ended, starting within 7 days) inside the bbox, soonest first, at most 200. */
  async map(viewerId: string, bbox: Bbox): Promise<EventMapResult> {
    await this.rateLimiter.consumeOrThrow([{ key: `map-events:${viewerId}`, limit: EVENT_LIMITS.mapRequestsPerMinute, windowSec: 60 }]);
    const where = Prisma.sql`
      ${ENDS} > now()
      AND e.starts_at <= now() + make_interval(days => ${EVENT_LIMITS.mapDays}::int)
      AND e.location && ST_MakeEnvelope(${bbox.minLng}::float8, ${bbox.minLat}::float8, ${bbox.maxLng}::float8, ${bbox.maxLat}::float8, 4326)::geography`;
    const rows = await this.query(viewerId, where, Prisma.sql`e.starts_at ASC, e.id ASC`, EVENT_LIMITS.mapMax + 1);
    return {
      items: rows.slice(0, EVENT_LIMITS.mapMax).map((r) => ({
        id: r.id,
        title: r.title,
        place: r.place,
        lat: r.lat,
        lng: r.lng,
        startsAt: r.startsAt.toISOString(),
        communityName: r.communityName,
        goingCount: r.goingCount,
        myRsvp: r.myRsvp,
      })),
      truncated: rows.length > EVENT_LIMITS.mapMax,
    };
  }

  /* ------------------------------------------------------------------ writing */

  /** Community owners and moderators. Notifies the other active members (`event_new`). */
  async create(userId: string, communityId: string, input: CreateEventInput): Promise<EventDto> {
    const community = await this.prisma.community.findFirst({ where: { id: communityId, deletedAt: null }, select: { id: true, name: true } });
    if (!community) throw Errors.notFound('Community not found');
    const role = await this.activeRole(communityId, userId);
    if (!isMod(role)) throw Errors.forbidden('Only the owner and moderators can create events');
    await this.rateLimiter.consumeOrThrow([{ key: `event-create:${userId}`, limit: EVENT_LIMITS.createsPerDay, windowSec: 86_400 }]);
    const id = newId();
    await this.prisma.$executeRaw`
      INSERT INTO events (id, community_id, created_by_id, title, description, place, location, starts_at, ends_at, route, updated_at)
      VALUES (${id}::uuid, ${communityId}::uuid, ${userId}::uuid, ${input.title}, ${input.description}, ${input.place},
              ST_SetSRID(ST_MakePoint(${input.lng}::float8, ${input.lat}::float8), 4326)::geography,
              ${input.startsAt}, ${input.endsAt ?? null}, ${input.route ? JSON.stringify(input.route) : null}::jsonb, now())`;
    await this.queue.scheduleReminder(id, input.startsAt).catch((err: unknown) => this.logger.warn({ err }, 'Scheduling a reminder failed'));
    const payload = notificationPayload({ id, communityId, communityName: community.name, title: input.title, startsAt: input.startsAt, place: input.place });
    this.tasks.run('event_new notifications', () => this.notifyMembers(communityId, userId, payload));
    return this.get(userId, id);
  }

  /**
   * The creator or a community owner/moderator. A new startsAt reschedules the reminder; any change
   * notifies the participants (`event_new` with `change: 'updated'`).
   */
  async update(userId: string, id: string, input: UpdateEventInput): Promise<EventDto> {
    await this.rateLimiter.consumeOrThrow([{ key: `event-update:${userId}`, limit: EVENT_LIMITS.updatesPerHour, windowSec: 3600 }]);
    const result = await this.prisma.$transaction(async (tx) => {
      const before = await this.lockManageable(tx, userId, id);
      const startsAt = input.startsAt ?? before.startsAt;
      const endsAt = input.endsAt === undefined ? before.endsAt : input.endsAt;
      const issues =
        input.startsAt !== undefined
          ? eventTimeIssues(startsAt, endsAt)
          : endsAt && endsAt <= startsAt
            ? [{ path: 'endsAt', message: 'Must be after the start' }]
            : [];
      if (issues.length) throw Errors.validation('Invalid event time', issues.map((i) => ({ path: [i.path], message: i.message })));

      const timeChanged = startsAt.getTime() !== before.startsAt.getTime();
      const changed =
        timeChanged ||
        (endsAt?.getTime() ?? null) !== (before.endsAt?.getTime() ?? null) ||
        (input.title !== undefined && input.title !== before.title) ||
        (input.description !== undefined && input.description !== before.description) ||
        (input.place !== undefined && input.place !== before.place) ||
        (input.lat !== undefined && input.lat !== before.lat) ||
        (input.lng !== undefined && input.lng !== before.lng) ||
        (input.route !== undefined && JSON.stringify(input.route) !== JSON.stringify(before.route));
      if (!changed) return { before, changed: false, timeChanged: false };

      await tx.event.update({
        where: { id },
        data: {
          title: input.title,
          description: input.description,
          place: input.place,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          route: input.route === undefined ? undefined : input.route === null ? Prisma.DbNull : (input.route as Prisma.InputJsonValue),
          ...(timeChanged ? { reminderSentAt: null } : {}),
        },
      });
      if (input.lat !== undefined || input.lng !== undefined) {
        const lat = input.lat ?? before.lat;
        const lng = input.lng ?? before.lng;
        await tx.$executeRaw`UPDATE events SET location = ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)::geography WHERE id = ${id}::uuid`;
      }
      return { before, changed: true, timeChanged };
    });
    if (result.timeChanged) {
      const startsAt = input.startsAt!;
      await this.queue.cancelReminder(id, result.before.startsAt);
      await this.queue.scheduleReminder(id, startsAt).catch((err: unknown) => this.logger.warn({ err }, 'Rescheduling a reminder failed'));
    }
    const dto = await this.get(userId, id);
    if (result.changed) {
      const payload = { ...notificationPayload({ ...dto, communityId: dto.community.id, communityName: dto.community.name, startsAt: new Date(dto.startsAt) }), change: 'updated' as const };
      this.tasks.run('event update notices', () => this.notifyUpdated(id, userId, payload));
    }
    return dto;
  }

  /** Hard delete by the creator or a community owner/moderator; participants get a cancel notice. */
  async remove(userId: string, id: string): Promise<void> {
    const { event, participantIds, chat } = await this.prisma.$transaction(async (tx) => {
      const event = await this.lockManageable(tx, userId, id);
      const participants = await this.visibleParticipants(id, {}, tx);
      const chat = await tx.chat.findUnique({ where: { refId: id }, select: { id: true, members: { select: { userId: true } } } });
      if (chat) await tx.chat.delete({ where: { id: chat.id } });
      await tx.event.delete({ where: { id } });
      return { event, participantIds: participants.map((p) => p.userId), chat };
    });
    if (chat) this.chats.revoked(chat.id, chat.members.map((m) => m.userId));
    await this.queue.cancelReminder(id, event.startsAt);
    const payload = { ...notificationPayload({ ...event, communityName: event.communityName }), change: 'cancelled' as const };
    const recipients = participantIds.filter((u) => u !== userId);
    if (recipients.length) await this.notifications.createMany('event_new', recipients.map((u) => ({ userId: u, payload })));
  }

  /**
   * `going` joins the event chat (created on the first `going`), leaving `going` leaves it. Only for events
   * the viewer can see that haven't ended; at most EVENT_LIMITS.maxGoing going → 409 EVENT_FULL.
   */
  async rsvp(userId: string, id: string, input: RsvpInput): Promise<EventDto> {
    await this.rateLimiter.consumeOrThrow([{ key: `event-rsvp:${userId}`, limit: EVENT_LIMITS.rsvpsPerMinute, windowSec: 60 }]);
    const change = await this.prisma.$transaction(async (tx) => {
      // Lock first, then check visibility: a concurrent leave/removal (which locks the community's events)
      // is then either fully visible here or waits for this RSVP and cleans it up.
      const [event] = await tx.$queryRaw<{ goingCount: number; ended: boolean }[]>`
        SELECT e.going_count AS "goingCount", ${ENDS} <= now() AS ended FROM events e WHERE e.id = ${id}::uuid FOR UPDATE`;
      if (!event) throw notFound();
      await this.requireVisible(userId, id, tx);
      if (event.ended) throw Errors.conflict('EVENT_ENDED', 'This event has already ended');
      const current = await tx.eventParticipant.findUnique({ where: { eventId_userId: { eventId: id, userId } }, select: { status: true } });
      const wasGoing = current?.status === 'going';
      const next = input.status === 'none' ? null : input.status;
      if ((current?.status ?? null) === next) return { joined: false, left: false };
      if (next === 'going' && event.goingCount >= EVENT_LIMITS.maxGoing) {
        throw Errors.conflict('EVENT_FULL', `At most ${EVENT_LIMITS.maxGoing} people can go to an event`);
      }
      if (next === null) await tx.eventParticipant.delete({ where: { eventId_userId: { eventId: id, userId } } });
      else
        await tx.eventParticipant.upsert({
          where: { eventId_userId: { eventId: id, userId } },
          create: { eventId: id, userId, status: next },
          update: { status: next },
        });
      const delta = (next === 'going' ? 1 : 0) - (wasGoing ? 1 : 0);
      if (delta) await tx.event.update({ where: { id }, data: { goingCount: { increment: delta } } });
      return { joined: next === 'going', left: wasGoing };
    });
    if (change.joined) await this.chats.ensureGroupChat('event', id, [userId]);
    if (change.left) {
      const chat = await this.prisma.chat.findUnique({ where: { refId: id }, select: { id: true } });
      if (chat) await this.chats.removeFromChat(chat.id, [userId]);
    }
    return this.get(userId, id);
  }

  /* ------------------------------------------------------------------ reminders */

  /** The delayed job: going participants get `event_reminder` once, unless the event moved or is gone. */
  async remind(job: ReminderJob): Promise<number> {
    const event = await this.prisma.event.findUnique({
      where: { id: job.eventId },
      include: { community: { select: { name: true, deletedAt: true } } },
    });
    if (!event || event.community.deletedAt || event.startsAt.toISOString() !== job.startsAt || event.reminderSentAt) return 0;
    const { count } = await this.prisma.event.updateMany({
      where: { id: event.id, reminderSentAt: null, startsAt: event.startsAt },
      data: { reminderSentAt: new Date() },
    });
    if (!count) return 0;
    const going = await this.visibleParticipants(event.id, { status: 'going' });
    const payload = notificationPayload({ ...event, communityName: event.community.name });
    await this.notifications.createMany('event_reminder', going.map((g) => ({ userId: g.userId, payload })));
    return going.length;
  }

  /* ------------------------------------------------------------------ helpers */

  /** Whether the viewer may see the event (used by reports and the event chat). */
  async canView(viewerId: string, id: string): Promise<boolean> {
    return this.requireVisible(viewerId, id).then(
      () => true,
      () => false,
    );
  }

  private async notifyMembers(communityId: string, actorId: string, payload: EventNotificationPayload): Promise<void> {
    const since = new Date(Date.now() - EVENT_LIMITS.pushLookbackDays * 86_400_000);
    const [members, engaged] = await Promise.all([
      this.prisma.communityMember.findMany({ where: { communityId, status: 'active', userId: { not: actorId } }, select: { userId: true } }),
      this.prisma.$queryRaw<{ userId: string }[]>`
        SELECT DISTINCT ep.user_id AS "userId" FROM event_participants ep JOIN events e ON e.id = ep.event_id
        WHERE e.community_id = ${communityId}::uuid AND ep.created_at > ${since}`,
    ]);
    if (!members.length) return;
    await this.notifications.createMany(
      'event_new',
      members.map((m) => ({ userId: m.userId, payload })),
      { pushTo: new Set(engaged.map((e) => e.userId)) },
    );
  }

  /** "Event updated" notices: at most one per event per EVENT_LIMITS.updateNotifyThrottleSec (Redis SET NX). */
  private async notifyUpdated(eventId: string, actorId: string, payload: EventNotificationPayload): Promise<void> {
    const fresh = await this.redis.set(`notify:event_updated:${eventId}`, actorId, 'EX', EVENT_LIMITS.updateNotifyThrottleSec, 'NX');
    if (fresh !== 'OK') return;
    await this.notifyParticipants(eventId, actorId, payload);
  }

  private async notifyParticipants(eventId: string, actorId: string, payload: EventNotificationPayload): Promise<void> {
    const participants = (await this.visibleParticipants(eventId)).filter((p) => p.userId !== actorId);
    if (participants.length) await this.notifications.createMany('event_new', participants.map((p) => ({ userId: p.userId, payload })));
  }

  /**
   * Participants who can still see the event: its community is live and public, or they are active
   * members of it (someone who left a private community keeps no access through an old RSVP).
   */
  private visibleParticipants(eventId: string, opts: { status?: RsvpStatus } = {}, db: Tx = this.prisma): Promise<{ userId: string }[]> {
    return db.$queryRaw<{ userId: string }[]>`
      SELECT ep.user_id AS "userId"
      FROM event_participants ep
      JOIN events e ON e.id = ep.event_id
      JOIN communities c ON c.id = e.community_id AND c.deleted_at IS NULL
      LEFT JOIN community_members m ON m.community_id = c.id AND m.user_id = ep.user_id AND m.status = 'active'
      WHERE ep.event_id = ${eventId}::uuid AND (c.is_private = false OR m.user_id IS NOT NULL)
        ${opts.status ? Prisma.sql`AND ep.status = ${opts.status}::"RsvpStatus"` : Prisma.empty}`;
  }

  private async activeRole(communityId: string, userId: string): Promise<string | null> {
    const m = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId } },
      select: { role: true, status: true },
    });
    return m?.status === 'active' ? m.role : null;
  }

  private async assertCommunityVisible(viewerId: string, communityId: string): Promise<void> {
    const c = await this.prisma.community.findFirst({ where: { id: communityId, deletedAt: null }, select: { isPrivate: true } });
    if (!c) throw Errors.notFound('Community not found');
    if (c.isPrivate && !(await this.activeRole(communityId, viewerId))) {
      throw Errors.forbidden('Events of a private community are visible to its members only');
    }
  }

  /** 404 unless the viewer can see the event. */
  private async requireVisible(viewerId: string, id: string, db: Tx = this.prisma): Promise<EventRow> {
    const [row] = await this.query(viewerId, Prisma.sql`e.id = ${id}::uuid`, Prisma.sql`e.id`, 1, db);
    if (!row) throw notFound();
    return row;
  }

  /** Locks the event row and checks the viewer may manage it (visible; creator or active owner/moderator). */
  private async lockManageable(tx: Tx, userId: string, id: string): Promise<EventRow> {
    await tx.$queryRaw`SELECT id FROM events WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await this.requireVisible(userId, id, tx);
    // The creator manages the event only while still an active member of the community.
    if (!row.myRole || (row.createdById !== userId && !isMod(row.myRole))) throw Errors.forbidden('Only the creator and community moderators can change this event');
    return row;
  }

  /**
   * Visible events: the community is live, and public or the viewer is an active member. One statement
   * returns everything the DTO needs except users and chat ids.
   */
  private query(viewerId: string, where: Prisma.Sql, order: Prisma.Sql, limit: number, db: Tx = this.prisma): Promise<EventRow[]> {
    const me = Prisma.sql`${viewerId}::uuid`;
    return db.$queryRaw<EventRow[]>`
      SELECT e.id, e.community_id AS "communityId", e.created_by_id AS "createdById", e.title, e.description, e.place,
             ST_Y(e.location::geometry) AS lat, ST_X(e.location::geometry) AS lng,
             e.starts_at AS "startsAt", e.ends_at AS "endsAt", e.route, e.going_count AS "goingCount",
             (SELECT count(*)::int FROM event_participants ip WHERE ip.event_id = e.id AND ip.status = 'interested') AS "interestedCount",
             mp.status::text AS "myRsvp", vm.role::text AS "myRole",
             c.name AS "communityName", c.is_private AS "communityPrivate", cu.key AS "avatarKey", cu.thumb_key AS "avatarThumbKey",
             CASE WHEN ul.location IS NULL THEN NULL ELSE round(ST_Distance(ul.location, e.location))::int END AS "distanceM"
      FROM events e
      JOIN communities c ON c.id = e.community_id AND c.deleted_at IS NULL
      LEFT JOIN uploads cu ON cu.id = c.avatar_upload_id
      LEFT JOIN community_members vm ON vm.community_id = c.id AND vm.user_id = ${me} AND vm.status = 'active'
      LEFT JOIN event_participants mp ON mp.event_id = e.id AND mp.user_id = ${me}
      LEFT JOIN user_locations ul ON ul.user_id = ${me}
      WHERE (c.is_private = false OR vm.user_id IS NOT NULL) AND ${where}
      ORDER BY ${order}
      LIMIT ${limit}::int`;
  }

  /** Creators and event chats for a page in one query each. */
  private async toDtos(viewerId: string, rows: EventRow[]): Promise<EventDto[]> {
    if (!rows.length) return [];
    const creatorIds = [...new Set(rows.map((r) => r.createdById))];
    const goingIds = rows.filter((r) => r.myRsvp === 'going').map((r) => r.id);
    const [creators, chats] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: creatorIds } }, include: userViewInclude }),
      goingIds.length ? this.prisma.chat.findMany({ where: { refId: { in: goingIds } }, select: { id: true, refId: true } }) : Promise.resolve([]),
    ]);
    const creatorById = new Map(creators.map((u) => [u.id, this.userView.toMini(u)]));
    const chatByEvent = new Map(chats.map((c) => [c.refId, c.id]));
    return rows.map((r) => {
      const avatar = r.avatarThumbKey ?? r.avatarKey;
      return {
        id: r.id,
        community: { id: r.communityId, name: r.communityName, avatarUrl: avatar ? this.storage.publicUrl(avatar) : null, isPrivate: r.communityPrivate },
        createdBy: creatorById.get(r.createdById) ?? { id: r.createdById, nickname: '', name: '', avatarUrl: null, rating: 0, isPremium: false },
        title: r.title,
        description: r.description,
        place: r.place,
        lat: r.lat,
        lng: r.lng,
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt?.toISOString() ?? null,
        route: Array.isArray(r.route) ? (r.route as RoutePoint[]) : null,
        goingCount: r.goingCount,
        interestedCount: r.interestedCount,
        myRsvp: r.myRsvp,
        chatId: r.myRsvp === 'going' ? (chatByEvent.get(r.id) ?? null) : null,
        distanceM: r.distanceM,
        canManage: isMod(r.myRole) || (r.createdById === viewerId && r.myRole !== null),
      };
    });
  }
}

function notificationPayload(e: { id: string; communityId: string; communityName: string; title: string; startsAt: Date; place: string }): EventNotificationPayload {
  return { eventId: e.id, communityId: e.communityId, communityName: e.communityName, title: e.title, startsAt: e.startsAt.toISOString(), place: e.place };
}

