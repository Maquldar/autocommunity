import {
  ADMIN_LIMITS,
  type AdminReportDto,
  type AdminStatsDto,
  type AdminUserRow,
  type AdminUserStatus,
  type FraudFlagDto,
  type SosStatus,
} from '@autoc/shared';

/* ---------- dashboard ---------- */

export type StatTile = {
  key:
    | 'usersTotal'
    | 'usersActive7d'
    | 'usersNew7d'
    | 'usersBlocked'
    | 'sosOpen'
    | 'sos7d'
    | 'sosClosed7d'
    | 'firstResponse'
    | 'fakeRate'
    | 'reportsOpen'
    | 'servicesPending'
    | 'visitsPending'
    | 'communities';
  /** Already formatted for display. */
  value: string;
  /** Raw number for sorting/tests; null when there is no data yet. */
  raw: number | null;
  /** Needs attention (non-zero moderation queue, high fake rate). */
  attention: boolean;
  href: string | null;
  group: 'users' | 'sos' | 'moderation';
};

/** Seconds → "45 s", "3 min 20 s", "1 h 05 min" style parts for i18n (`{m} min {s} s`). */
export function durationParts(sec: number | null): { h: number; m: number; s: number } | null {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return null;
  const total = Math.round(sec);
  return { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
}

export function formatDuration(sec: number | null, units: { h: string; m: string; s: string } = { h: 'h', m: 'min', s: 's' }): string {
  const p = durationParts(sec);
  if (!p) return '—';
  if (p.h) return `${p.h} ${units.h} ${String(p.m).padStart(2, '0')} ${units.m}`;
  if (p.m) return `${p.m} ${units.m} ${p.s} ${units.s}`;
  return `${p.s} ${units.s}`;
}

export const formatPercent = (ratio: number, locale = 'en'): string =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(Number.isFinite(ratio) ? ratio : 0);

/** A fake rate above this is highlighted on the dashboard. */
export const FAKE_RATE_ALERT = 0.05;

export function statTiles(stats: AdminStatsDto, opts: { locale?: string; units?: { h: string; m: string; s: string } } = {}): StatTile[] {
  const n = (v: number) => new Intl.NumberFormat(opts.locale ?? 'en').format(v);
  return [
    { key: 'usersTotal', value: n(stats.users.total), raw: stats.users.total, attention: false, href: '/admin/users', group: 'users' },
    { key: 'usersActive7d', value: n(stats.users.active7d), raw: stats.users.active7d, attention: false, href: null, group: 'users' },
    { key: 'usersNew7d', value: n(stats.users.new7d), raw: stats.users.new7d, attention: false, href: null, group: 'users' },
    { key: 'usersBlocked', value: n(stats.users.blocked), raw: stats.users.blocked, attention: false, href: '/admin/users?status=blocked', group: 'users' },
    { key: 'sosOpen', value: n(stats.sos.open), raw: stats.sos.open, attention: stats.sos.open > 0, href: '/admin/sos?status=created', group: 'sos' },
    { key: 'sos7d', value: n(stats.sos.last7d), raw: stats.sos.last7d, attention: false, href: '/admin/sos', group: 'sos' },
    { key: 'sosClosed7d', value: n(stats.sos.closed7d), raw: stats.sos.closed7d, attention: false, href: '/admin/sos?status=closed', group: 'sos' },
    {
      key: 'firstResponse',
      value: formatDuration(stats.sos.medianFirstResponseSec7d, opts.units),
      raw: stats.sos.medianFirstResponseSec7d,
      attention: false,
      href: null,
      group: 'sos',
    },
    {
      key: 'fakeRate',
      value: formatPercent(stats.sos.fakeRate30d, opts.locale),
      raw: stats.sos.fakeRate30d,
      attention: stats.sos.fakeRate30d > FAKE_RATE_ALERT,
      href: null,
      group: 'sos',
    },
    { key: 'reportsOpen', value: n(stats.reports.open), raw: stats.reports.open, attention: stats.reports.open > 0, href: '/admin/reports', group: 'moderation' },
    {
      key: 'servicesPending',
      value: n(stats.services.pending),
      raw: stats.services.pending,
      attention: stats.services.pending > 0,
      href: '/admin/services',
      group: 'moderation',
    },
    { key: 'visitsPending', value: n(stats.visits.pending), raw: stats.visits.pending, attention: stats.visits.pending > 0, href: '/admin/visits', group: 'moderation' },
    { key: 'communities', value: n(stats.communities.total), raw: stats.communities.total, attention: false, href: '/admin/communities', group: 'moderation' },
  ];
}

/* ---------- users ---------- */

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'outline';

export const USER_STATUS_TONE: Record<AdminUserStatus, BadgeTone> = { active: 'success', blocked: 'danger', deleted: 'neutral' };

export function isSosBanned(user: Pick<AdminUserRow, 'sosBannedUntil'>, now = Date.now()): boolean {
  return user.sosBannedUntil !== null && Date.parse(user.sosBannedUntil) > now;
}

/** Which actions the detail page offers (the API refuses the rest with 403/409 anyway). */
export function userActions(user: Pick<AdminUserRow, 'id' | 'role' | 'status' | 'sosBannedUntil'>, adminId: string, now = Date.now()) {
  const protectedTarget = user.id === adminId || user.role === 'admin';
  const live = user.status !== 'deleted';
  return {
    protectedTarget,
    warn: !protectedTarget && live,
    block: !protectedTarget && user.status === 'active',
    unblock: !protectedTarget && user.status === 'blocked',
    sosBan: !protectedTarget && live && !isSosBanned(user, now),
    sosUnban: !protectedTarget && isSosBanned(user, now),
  };
}

export const BLOCK_PRESETS = ['24h', '7d', '30d', 'forever'] as const;
export type BlockPreset = (typeof BLOCK_PRESETS)[number];
export const SOS_BAN_PRESETS = ['24h', '72h', '7d', '30d'] as const;
export type SosBanPreset = (typeof SOS_BAN_PRESETS)[number];

const PRESET_HOURS: Record<Exclude<BlockPreset | SosBanPreset, 'forever'>, number> = { '24h': 24, '72h': 72, '7d': 168, '30d': 720 };

/** ISO `until` for a duration preset; null for a permanent block. */
export function untilFromPreset(preset: BlockPreset | SosBanPreset, now = Date.now()): string | null {
  if (preset === 'forever') return null;
  return new Date(now + PRESET_HOURS[preset] * 3_600_000).toISOString();
}

/* ---------- notes ---------- */

export function noteError(note: string): 'tooShort' | 'tooLong' | null {
  const len = note.trim().length;
  if (len < ADMIN_LIMITS.noteMin) return 'tooShort';
  if (len > ADMIN_LIMITS.noteMax) return 'tooLong';
  return null;
}

/* ---------- reports ---------- */

/** Content that "remove content" can take down for this report (API.md §6). */
export function canRemoveContent(report: Pick<AdminReportDto, 'targetType' | 'reason' | 'preview' | 'status'>): boolean {
  if (report.status !== 'open' || report.preview.deleted) return false;
  if (report.targetType === 'sos') return report.reason === 'fake_sos';
  return report.targetType === 'message' || report.targetType === 'community' || report.targetType === 'service';
}

/** Where the admin can look at the reported thing (null when there is no page for it). */
export function reportTargetHref(report: Pick<AdminReportDto, 'targetType' | 'targetId' | 'targetUser' | 'preview'>): string | null {
  switch (report.targetType) {
    case 'user':
      return `/admin/users/${report.targetId}`;
    case 'sos':
      return `/admin/sos/${report.targetId}`;
    case 'community':
      return report.preview.deleted ? null : `/communities/${report.targetId}`;
    case 'service':
      return `/services/${report.targetId}`;
    default:
      return report.targetUser ? `/admin/users/${report.targetUser.id}` : null;
  }
}

/* ---------- SOS ---------- */

export const SOS_STATUS_TONE: Record<SosStatus, BadgeTone> = {
  created: 'warning',
  accepted: 'primary',
  in_progress: 'primary',
  closed: 'success',
  cancelled: 'neutral',
  expired: 'outline',
};

/* ---------- fraud flags ---------- */

/** The few details worth showing inline for each flag kind (values are strings/numbers only). */
export function flagFacts(flag: Pick<FraudFlagDto, 'kind' | 'details'>): Record<string, string | number> {
  const d = flag.details;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const out: Record<string, string | number> = {};
  const put = (key: string, v: string | number | null) => {
    if (v !== null) out[key] = v;
  };
  switch (flag.kind) {
    case 'sos_cancel_streak':
      put('count', num(d.count));
      put('until', str(d.bannedUntil));
      break;
    case 'report_burst':
      put('reporters', num(d.reporters));
      put('rating', num(d.rating));
      put('until', str(d.blockedUntil));
      break;
    case 'location_teleport':
      put('jumps', num(d.jumps));
      break;
    case 'new_account_sos':
      put('minutes', num(d.accountAgeMin));
      break;
    case 'duplicate_sos_photo':
      put('matches', Array.isArray(d.matches) ? d.matches.length : null);
      break;
    case 'otp_abuse':
      put('phone', str(d.phoneMasked));
      put('lockouts', num(d.lockouts));
      break;
  }
  return out;
}

/** The SOS a flag is about, when there is one (links to the SOS detail). */
export function flagSosId(flag: Pick<FraudFlagDto, 'details'>): string | null {
  const d = flag.details;
  const id = d.sosId ?? d.triggerSosId;
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/* ---------- lists ---------- */

/** Flattens infinite-query pages. */
export function flatten<T>(data: { pages: { items: T[] }[] } | undefined): T[] {
  return data?.pages.flatMap((p) => p.items) ?? [];
}

/** Parses an enum-like search param (unknown values → undefined). */
export function pickParam<T extends string>(value: string | null | undefined, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}
