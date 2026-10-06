import type { NotificationDto, UserMini } from '@autoc/shared';

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
  | {
      kind: 'moderation';
      /** admin_warning kinds, `report_confirmed|dismissed`, `service_verified|rejected`, `visit_verified|rejected`. */
      variant: ModerationVariant;
      note: string | null;
      until: string | null;
      serviceName: string;
      href: string | null;
    }
  | { kind: 'generic'; type: string; href: string | null };

export type ModerationVariant =
  | 'warning'
  | 'blocked'
  | 'sos_ban'
  | 'fake_sos'
  | 'report_confirmed'
  | 'report_dismissed'
  | 'service_verified'
  | 'service_rejected'
  | 'visit_verified'
  | 'visit_rejected';

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

export function describeNotification(notification: Pick<NotificationDto, 'type' | 'payload'>): NotificationView {
  const payload = isRecord(notification.payload) ? notification.payload : {};
  switch (notification.type) {
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
    case 'admin_warning':
    case 'report_resolved':
    case 'service_status':
    case 'visit_status':
      return describeModeration(notification.type, payload);
    default:
      return { kind: 'generic', type: String(notification.type), href: safePath(payload.url) };
  }
}

/** Phase 6 moderation outcomes (API.md §6 payloads). Unknown variants fall back to the generic row. */
function describeModeration(type: string, payload: Record<string, unknown>): NotificationView {
  const note = typeof payload.note === 'string' && payload.note ? payload.note : null;
  const until = typeof payload.until === 'string' && !Number.isNaN(Date.parse(payload.until)) ? payload.until : null;
  const serviceId = safeId(payload.serviceId);
  const base = { kind: 'moderation' as const, note, until, serviceName: text(payload.serviceName) };
  if (type === 'admin_warning') {
    const variant = payload.kind;
    if (variant === 'warning' || variant === 'blocked' || variant === 'sos_ban' || variant === 'fake_sos') return { ...base, variant, href: null };
  } else if (type === 'report_resolved') {
    return { ...base, note: null, variant: payload.decision === 'confirmed' ? 'report_confirmed' : 'report_dismissed', href: null };
  } else if (payload.status === 'verified' || payload.status === 'rejected') {
    const prefix = type === 'service_status' ? 'service' : 'visit';
    return { ...base, variant: `${prefix}_${payload.status}`, href: serviceId ? `/services/${serviceId}` : null };
  }
  return { kind: 'generic', type, href: null };
}

/** Display name for a user from a payload: name, else @nickname. */
export function displayName(user: UserMini | null): string | null {
  if (!user) return null;
  return user.name || (user.nickname ? `@${user.nickname}` : null);
}
