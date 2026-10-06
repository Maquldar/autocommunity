import { z } from 'zod';
import { bboxSchema, bodyLatSchema, bodyLngSchema, idSchema, INVISIBLE_RE, paginationQuerySchema } from './schemas';
import type { UserMini } from './types';

/* ---------- limits (phase 8, API.md §8) ---------- */

export const EVENT_LIMITS = {
  titleMin: 3,
  titleMax: 100,
  descriptionMax: 2000,
  placeMin: 2,
  placeMax: 200,
  routeMin: 2,
  routeMax: 200,
  /** `startsAt` at most this far ahead. */
  maxAheadDays: 365,
  /** Max `going` participants → 409 EVENT_FULL. */
  maxGoing: 500,
  /** An event without `endsAt` counts as ended this long after it started. */
  defaultDurationHours: 3,
  /** `event_reminder` goes out this long before the start (API env EVENT_REMINDER_LEAD_MS overrides it). */
  reminderLeadMs: 2 * 3600_000,
  /** `/map/events` shows upcoming events starting within this many days. */
  mapDays: 7,
  mapMax: 200,
  /** `event_new` is pushed only to members who RSVPed to an event of the community within this window. */
  pushLookbackDays: 90,
  /** Per-user rate limits (429 RATE_LIMITED). */
  createsPerDay: 10,
  updatesPerHour: 30,
  rsvpsPerMinute: 30,
  /** `/map/events` requests per user per minute (same budget as `/map/users`). */
  mapRequestsPerMinute: 60,
  /** At most one "event updated" notice per event per this many seconds. */
  updateNotifyThrottleSec: 600,
} as const;

export const RSVP_STATUSES = ['going', 'interested'] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

/* ---------- DTOs ---------- */

/** `[lng, lat]` (GeoJSON order). */
export type RoutePoint = [number, number];

export type EventCommunity = { id: string; name: string; avatarUrl: string | null; isPrivate: boolean };

export type EventDto = {
  id: string;
  community: EventCommunity;
  createdBy: UserMini;
  title: string;
  description: string;
  place: string;
  lat: number;
  lng: number;
  startsAt: string;
  endsAt: string | null;
  route: RoutePoint[] | null;
  goingCount: number;
  interestedCount: number;
  myRsvp: RsvpStatus | null;
  /** Only when myRsvp = 'going'. */
  chatId: string | null;
  /** From the viewer's stored position; null without one. */
  distanceM: number | null;
  /** The viewer may edit / delete it (creator, community owner or moderator). */
  canManage: boolean;
};

export type EventParticipantDto = { user: UserMini; status: RsvpStatus; createdAt: string };

export type EventMapItem = {
  id: string;
  title: string;
  place: string;
  lat: number;
  lng: number;
  startsAt: string;
  communityName: string;
  goingCount: number;
  myRsvp: RsvpStatus | null;
};

export type EventMapResult = { items: EventMapItem[]; truncated: boolean };

/** `event_new` payload; `change` is set for update / cancel notices to participants. */
export type EventNotificationPayload = {
  eventId: string;
  communityId: string;
  communityName: string;
  title: string;
  startsAt: string;
  place: string;
  change?: 'updated' | 'cancelled';
};

/* ---------- request schemas ---------- */

const singleLine = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((v) => !INVISIBLE_RE.test(v) && !/[\r\n\t]/.test(v), 'Contains invalid characters');

export const eventTitleSchema = singleLine(EVENT_LIMITS.titleMin, EVENT_LIMITS.titleMax);
export const eventPlaceSchema = singleLine(EVENT_LIMITS.placeMin, EVENT_LIMITS.placeMax);
export const eventDescriptionSchema = z
  .string()
  .trim()
  .max(EVENT_LIMITS.descriptionMax)
  .refine((v) => !INVISIBLE_RE.test(v.replace(/[\t\n\r]/g, '')), 'Contains invalid characters');

/** ISO-8601 timestamp with an offset (e.g. `2026-10-10T09:00:00.000Z`) → Date. */
export const isoDateSchema = z.iso.datetime({ offset: true }).transform((v) => new Date(v));

export const routePointSchema = z.tuple([bodyLngSchema, bodyLatSchema]);
export const routeSchema = z.array(routePointSchema).min(EVENT_LIMITS.routeMin).max(EVENT_LIMITS.routeMax);

const eventFields = {
  title: eventTitleSchema,
  description: eventDescriptionSchema,
  place: eventPlaceSchema,
  lat: bodyLatSchema,
  lng: bodyLngSchema,
  startsAt: isoDateSchema,
  endsAt: isoDateSchema.nullable(),
  route: routeSchema.nullable(),
};

/** Time rules shared by create and (merged) update; `now` is injectable for tests. */
export function eventTimeIssues(startsAt: Date, endsAt: Date | null, now = Date.now()): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (startsAt.getTime() <= now) issues.push({ path: 'startsAt', message: 'Must be in the future' });
  if (startsAt.getTime() > now + EVENT_LIMITS.maxAheadDays * 86_400_000) issues.push({ path: 'startsAt', message: 'At most one year ahead' });
  if (endsAt && endsAt.getTime() <= startsAt.getTime()) issues.push({ path: 'endsAt', message: 'Must be after the start' });
  return issues;
}

export const createEventSchema = z
  .object({
    ...eventFields,
    description: eventFields.description.default(''),
    endsAt: eventFields.endsAt.optional(),
    route: eventFields.route.optional(),
  })
  .superRefine((v, ctx) => {
    // Runs even when a field failed (zod 4): only check real dates.
    if (!(v.startsAt instanceof Date) || (v.endsAt != null && !(v.endsAt instanceof Date))) return;
    for (const i of eventTimeIssues(v.startsAt, v.endsAt ?? null)) ctx.addIssue({ code: 'custom', path: [i.path], message: i.message });
  });
export type CreateEventInput = z.output<typeof createEventSchema>;

/** Partial; the time rules are re-checked by the server against the merged event. `null` clears endsAt / route. */
export const updateEventSchema = z.object(eventFields).partial();
export type UpdateEventInput = z.output<typeof updateEventSchema>;

export const rsvpSchema = z.object({ status: z.enum(['going', 'interested', 'none']) });
export type RsvpInput = z.output<typeof rsvpSchema>;

export const eventsQuerySchema = paginationQuerySchema.extend({
  scope: z.enum(['upcoming', 'past']).default('upcoming'),
  communityId: idSchema.optional(),
});
export type EventsQuery = z.output<typeof eventsQuerySchema>;

export const communityEventsQuerySchema = paginationQuerySchema.extend({
  scope: z.enum(['upcoming', 'past']).default('upcoming'),
});

export const eventParticipantsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(RSVP_STATUSES).optional(),
});

export const mapEventsQuerySchema = z.object({ bbox: bboxSchema });

/** The moment an event counts as over (endsAt, else startsAt + defaultDurationHours). */
export function eventEndsAt(e: { startsAt: string | Date; endsAt: string | Date | null }): Date {
  if (e.endsAt) return new Date(e.endsAt);
  return new Date(new Date(e.startsAt).getTime() + EVENT_LIMITS.defaultDurationHours * 3600_000);
}
