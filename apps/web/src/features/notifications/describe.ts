import { SOS_STATUSES, SOS_TYPES, type NotificationDto, type SosStatus, type SosType, type UserMini } from '@autoc/shared';

/**
 * Turns a NotificationDto (free-form `payload`) into what the UI renders. Phase 2 types have their own
 * view; every other type renders generically until its phase ships. Payloads are validated defensively.
 */
export type NotificationView =
  | { kind: 'friend_request'; user: UserMini | null; requestId: string | null; href: string | null }
  | { kind: 'friend_accepted'; user: UserMini | null; href: string | null }
  | { kind: 'community_request'; user: UserMini | null; communityId: string | null; communityName: string; href: string | null }
  | { kind: 'community_approved'; communityId: string | null; communityName: string; href: string | null }
  | {
      kind: 'community_role';
      communityId: string | null;
      communityName: string;
      role: 'owner' | 'moderator' | 'member';
      href: string | null;
    }
  | { kind: 'sos_nearby'; sosId: string | null; sosType: SosType; distanceM: number | null; user: UserMini | null; href: string | null }
  | { kind: 'sos_response'; sosId: string | null; user: UserMini | null; href: string | null }
  | { kind: 'sos_accepted'; sosId: string | null; user: UserMini | null; href: string | null }
  | {
      kind: 'sos_status';
      sosId: string | null;
      status: SosStatus | null;
      /** What happened (API.md §4 clarifications); falls back to the status for close/cancel/expire. */
      event: SosStatusEvent;
      user: UserMini | null;
      href: string | null;
    }
  | { kind: 'generic'; type: string; href: string | null };

export type SosStatusEvent = 'withdrawn' | 'declined' | 'arrived' | 'in_progress' | 'closed' | 'cancelled' | 'expired' | 'other';

/** Kinds that carry a user (actor). */
export type UserNotificationView = Extract<NotificationView, { user: UserMini | null }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseUserMini(value: unknown): UserMini | null {
  if (!isRecord(value)) return null;
  const { id, nickname, name, avatarUrl, rating } = value;
  if (typeof id !== 'string' || !id) return null;
  return {
    id,
    nickname: typeof nickname === 'string' ? nickname : '',
    name: typeof name === 'string' && name ? name : typeof nickname === 'string' ? nickname : '',
    avatarUrl: typeof avatarUrl === 'string' ? avatarUrl : null,
    rating: typeof rating === 'number' && Number.isFinite(rating) ? rating : 50,
  };
}

/** Same-origin path from the payload (`url`), never an absolute or protocol-relative URL. */
function safePath(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : null;
}

/** Ids go into URLs: accept only plain id characters. */
function safeId(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(value) ? value : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sosStatusEvent(event: unknown, status: SosStatus | null): SosStatusEvent {
  if (event === 'withdrawn' || event === 'declined' || event === 'arrived' || event === 'in_progress') return event;
  if (status === 'closed' || status === 'cancelled' || status === 'expired') return status;
  if (status === 'in_progress') return 'in_progress';
  return 'other';
}

export function describeNotification(notification: Pick<NotificationDto, 'type' | 'payload'>): NotificationView {
  const payload = isRecord(notification.payload) ? notification.payload : {};
  const sosId = safeId(payload.sosId);
  const sosHref = sosId ? `/sos/${sosId}` : null;
  switch (notification.type) {
    case 'sos_nearby': {
      const sosType = typeof payload.type === 'string' && (SOS_TYPES as readonly string[]).includes(payload.type) ? (payload.type as SosType) : 'other';
      const distanceM = typeof payload.distanceM === 'number' && Number.isFinite(payload.distanceM) ? payload.distanceM : null;
      return { kind: 'sos_nearby', sosId, sosType, distanceM, user: parseUserMini(payload.requester), href: sosHref };
    }
    case 'sos_response':
      return { kind: 'sos_response', sosId, user: parseUserMini(payload.helper), href: sosHref };
    case 'sos_accepted':
      return { kind: 'sos_accepted', sosId, user: parseUserMini(payload.requester), href: sosHref };
    case 'sos_status': {
      const status = typeof payload.status === 'string' && (SOS_STATUSES as readonly string[]).includes(payload.status) ? (payload.status as SosStatus) : null;
      return { kind: 'sos_status', sosId, status, event: sosStatusEvent(payload.event, status), user: parseUserMini(payload.actor), href: sosHref };
    }
    case 'friend_request': {
      const user = parseUserMini(payload.user);
      const requestId = typeof payload.requestId === 'string' && payload.requestId ? payload.requestId : null;
      return { kind: 'friend_request', user, requestId, href: user ? `/u/${user.id}` : null };
    }
    case 'friend_accepted': {
      const user = parseUserMini(payload.user);
      return { kind: 'friend_accepted', user, href: user ? `/u/${user.id}` : null };
    }
    case 'community_request': {
      const communityId = safeId(payload.communityId);
      return {
        kind: 'community_request',
        user: parseUserMini(payload.user),
        communityId,
        communityName: text(payload.communityName),
        // Same target as the push URL: the Requests tab.
        href: communityId ? `/communities/${communityId}/requests` : null,
      };
    }
    case 'community_approved': {
      const communityId = safeId(payload.communityId);
      return {
        kind: 'community_approved',
        communityId,
        communityName: text(payload.communityName),
        href: communityId ? `/communities/${communityId}` : null,
      };
    }
    case 'community_role': {
      const communityId = safeId(payload.communityId);
      const role = payload.role === 'owner' || payload.role === 'moderator' ? payload.role : 'member';
      return {
        kind: 'community_role',
        communityId,
        communityName: text(payload.communityName),
        role,
        href: communityId ? `/communities/${communityId}` : null,
      };
    }
    default:
      return { kind: 'generic', type: String(notification.type), href: safePath(payload.url) };
  }
}

/** Display name for a user from a payload: name, else @nickname. */
export function displayName(user: UserMini | null): string | null {
  if (!user) return null;
  return user.name || (user.nickname ? `@${user.nickname}` : null);
}
