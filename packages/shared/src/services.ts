/**
 * Phase 7 — service-center catalog (API.md §7): enums, limits, zod schemas, DTOs and pure helpers
 * (opening hours in Asia/Almaty, Bayesian rating, QR code formatting) shared by the API and the web app.
 */
import { z } from 'zod';
import type { UploadDto, UserMini } from './types';
import { bboxSchema, idSchema, latSchema, lngSchema, paginationQuerySchema, phoneSchema } from './schemas';

/* ---------- enums & limits ---------- */

export const SERVICE_CATEGORIES = ['repair', 'tires', 'wash', 'parts', 'tow', 'fuel'] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export const SERVICE_STATUSES = ['pending', 'verified', 'rejected'] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export const VISIT_METHODS = ['geo', 'qr', 'photo'] as const;
export type VisitMethod = (typeof VISIT_METHODS)[number];

export const VISIT_STATUSES = ['pending', 'verified', 'rejected'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

/** Monday first (Almaty week). */
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const SERVICE_LIMITS = {
  nameMin: 2,
  nameMax: 80,
  descriptionMax: 1000,
  addressMin: 5,
  addressMax: 200,
  photosMax: 6,
  reviewCommentMax: 1000,
  searchMin: 2,
  searchMax: 80,
  submissionsPerDay: 5,
  duplicateRadiusM: 30,
  geoVisitRadiusM: 150,
  visitWindowHours: 24,
  reviewCooldownDays: 30,
  mapMax: 500,
  mapMaxSpanDeg: 2,
  /** Visit attempts (any method, including failed ones) per user per hour — bounds QR guessing. */
  visitAttemptsPerHour: 30,
  reviewsPerDay: 20,
  qrCodeLength: 8,
} as const;

/** Bayesian prior: every service starts as if it had `weight` reviews of `mean` stars. */
export const SERVICE_RATING_PRIOR = { mean: 3.5, weight: 5 } as const;

/** Almaty uses a single offset (UTC+5) since 1 March 2024; the IANA zone is used where Intl supports it. */
export const SERVICE_TIME_ZONE = 'Asia/Almaty';

/* ---------- opening hours ---------- */

/** "HH:MM-HH:MM"; "00:00-24:00" = around the clock; an end before the start runs past midnight. */
const HOURS_RE = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]|24):([0-5]\d)$/;

export type ServiceHours = Record<Weekday, string | null>;

/** Parses "09:00-19:00" into minutes since midnight; null for malformed input. */
export function parseHoursRange(value: string): { start: number; end: number } | null {
  const m = HOURS_RE.exec(value);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  if (end > 24 * 60 || start === end) return null;
  return { start, end };
}

export const hoursRangeSchema = z
  .string()
  .trim()
  .refine((v) => parseHoursRange(v) !== null, 'Use HH:MM-HH:MM, e.g. 09:00-19:00');

export const serviceHoursSchema = z.object({
  mon: hoursRangeSchema.nullable(),
  tue: hoursRangeSchema.nullable(),
  wed: hoursRangeSchema.nullable(),
  thu: hoursRangeSchema.nullable(),
  fri: hoursRangeSchema.nullable(),
  sat: hoursRangeSchema.nullable(),
  sun: hoursRangeSchema.nullable(),
});

/** Coerces stored JSON into ServiceHours (unknown/malformed days become closed). */
export function normalizeHours(raw: unknown): ServiceHours {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = {} as ServiceHours;
  for (const day of WEEKDAYS) {
    const v = src[day];
    out[day] = typeof v === 'string' && parseHoursRange(v) ? v : null;
  }
  return out;
}

/** Wall-clock weekday and minutes in Asia/Almaty for an instant. */
export function almatyClock(at: Date): { day: Weekday; minutes: number; date: string } {
  let parts: Record<string, string>;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: SERVICE_TIME_ZONE,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  } catch {
    // No ICU time zone data: Almaty is UTC+5 year-round.
    const shifted = new Date(at.getTime() + 5 * 3_600_000);
    const iso = shifted.toISOString();
    parts = {
      weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][shifted.getUTCDay()]!,
      year: iso.slice(0, 4),
      month: iso.slice(5, 7),
      day: iso.slice(8, 10),
      hour: iso.slice(11, 13),
      minute: iso.slice(14, 16),
    };
  }
  const day = (parts.weekday ?? 'Mon').toLowerCase().slice(0, 3) as Weekday;
  const hour = Number(parts.hour) % 24;
  return { day, minutes: hour * 60 + Number(parts.minute), date: `${parts.year}-${parts.month}-${parts.day}` };
}

const previousDay = (day: Weekday): Weekday => WEEKDAYS[(WEEKDAYS.indexOf(day) + 6) % 7]!;

/**
 * Whether a service is open at `at` (Asia/Almaty wall clock). Null when no day has hours (unknown).
 * Overnight ranges ("20:00-02:00") count for the early hours of the next day.
 */
export function isOpenAt(hours: ServiceHours, at: Date): boolean | null {
  if (WEEKDAYS.every((d) => !hours[d])) return null;
  const { day, minutes } = almatyClock(at);
  const today = hours[day] ? parseHoursRange(hours[day]!) : null;
  if (today) {
    if (today.end > today.start) {
      if (minutes >= today.start && minutes < today.end) return true;
    } else if (minutes >= today.start) {
      return true;
    }
  }
  const prevValue = hours[previousDay(day)];
  const prev = prevValue ? parseHoursRange(prevValue) : null;
  if (prev && prev.end < prev.start && minutes < prev.end) return true;
  return false;
}

export const isAroundTheClock = (value: string | null): boolean => value === '00:00-24:00';

/* ---------- rating ---------- */

/** Bayesian average of review stars, rounded to one decimal (API.md §7). */
export function bayesianServiceRating(starsSum: number, reviewCount: number): number {
  const { mean, weight } = SERVICE_RATING_PRIOR;
  const value = (mean * weight + starsSum) / (weight + reviewCount);
  return Math.round(value * 10) / 10;
}

/* ---------- QR ---------- */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 (no padding) of the first bytes, truncated to `length` characters. */
export function base32(bytes: Uint8Array, length: number = SERVICE_LIMITS.qrCodeLength): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
      if (out.length >= length) return out;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0 && out.length < length) out += BASE32[(buffer << (5 - bits)) & 31];
  return out.slice(0, length);
}

/** Uppercases and strips separators/spaces from a typed or scanned code ("abcd-2345" → "ABCD2345"). */
export function normalizeQrCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z2-7]/g, '');
}

/**
 * The printed QR encodes `{web origin}/services/{id}?code={code}` so a phone camera opens the service page
 * with the code filled in. Accepts that URL or a bare code; returns the normalized code, or null.
 */
export function extractQrCode(scanned: string): string | null {
  const text = scanned.trim();
  let candidate = text;
  if (/^https?:\/\//i.test(text)) {
    try {
      candidate = new URL(text).searchParams.get('code') ?? '';
    } catch {
      return null;
    }
  }
  const code = normalizeQrCode(candidate);
  return code.length === SERVICE_LIMITS.qrCodeLength ? code : null;
}

/* ---------- request schemas ---------- */

export const serviceCategorySchema = z.enum(SERVICE_CATEGORIES);

const optionalLat = latSchema.optional();
const optionalLng = lngSchema.optional();

export const serviceListQuerySchema = paginationQuerySchema
  .extend({
    category: serviceCategorySchema.optional(),
    q: z.string().trim().min(SERVICE_LIMITS.searchMin).max(SERVICE_LIMITS.searchMax).optional(),
    lat: optionalLat,
    lng: optionalLng,
    sort: z.enum(['distance', 'rating']).optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.lat === undefined) !== (v.lng === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['lat'], message: 'lat and lng go together' });
    }
    if (v.sort === 'distance' && v.lat === undefined) {
      ctx.addIssue({ code: 'custom', path: ['sort'], message: 'sort=distance requires lat and lng' });
    }
  });
export type ServiceListQuery = z.output<typeof serviceListQuerySchema>;

export const serviceMapQuerySchema = z.object({
  bbox: bboxSchema,
  category: serviceCategorySchema.optional(),
});
export type ServiceMapQuery = z.output<typeof serviceMapQuerySchema>;

export const serviceDetailsQuerySchema = z
  .object({ lat: optionalLat, lng: optionalLng })
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), { message: 'lat and lng go together', path: ['lat'] });

const nonBlank = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((v) => !/[\u0000-\u0008\u000B-\u001F\u007F]/.test(v), 'Contains invalid characters');

export const createServiceSchema = z.object({
  name: nonBlank(SERVICE_LIMITS.nameMin, SERVICE_LIMITS.nameMax).refine((v) => !/[\n\t]/.test(v), 'Single line only'),
  category: serviceCategorySchema,
  description: z.string().trim().max(SERVICE_LIMITS.descriptionMax).default(''),
  address: nonBlank(SERVICE_LIMITS.addressMin, SERVICE_LIMITS.addressMax).refine((v) => !/[\n\t]/.test(v), 'Single line only'),
  phone: z
    .union([z.literal(''), phoneSchema])
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  hours: serviceHoursSchema,
  lat: latSchema,
  lng: lngSchema,
  photoUploadIds: z.array(idSchema).max(SERVICE_LIMITS.photosMax).default([]),
});
export type CreateServiceInput = z.input<typeof createServiceSchema>;
export type CreateServiceData = z.output<typeof createServiceSchema>;

export const createVisitSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('geo'), lat: latSchema, lng: lngSchema }),
  z.object({ method: z.literal('qr'), code: z.string().trim().min(1).max(64) }),
  z.object({ method: z.literal('photo'), uploadId: idSchema }),
]);
export type CreateVisitInput = z.input<typeof createVisitSchema>;

export const createServiceReviewSchema = z.object({
  visitId: idSchema,
  stars: z.coerce.number().int().min(1).max(5),
  comment: z
    .string()
    .trim()
    .max(SERVICE_LIMITS.reviewCommentMax)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
});
export type CreateServiceReviewInput = z.input<typeof createServiceReviewSchema>;

/* ---------- DTOs ---------- */

export type MyVisit = { id: string; method: VisitMethod; status: VisitStatus; createdAt: string; reviewed: boolean };

export type ServiceDto = {
  id: string;
  name: string;
  category: ServiceCategory;
  description: string;
  address: string;
  phone: string | null;
  hours: ServiceHours;
  photos: UploadDto[];
  lat: number;
  lng: number;
  rating: number;
  reviewCount: number;
  visitCount: number;
  status: ServiceStatus;
  distanceM: number | null;
  /** Asia/Almaty time; null when the service has no hours. */
  openNow: boolean | null;
  /** The viewer's latest visit. */
  myVisit: MyVisit | null;
  /** Phase 10: a payment partner ("Оплата на точке", API.md §10). */
  acceptsPayments: boolean;
  /** Phase 10: the viewer is an admin or the point's owner and may manage its price list. */
  canManagePay: boolean;
};

export type ServiceListItem = Omit<ServiceDto, 'description' | 'hours' | 'photos' | 'myVisit' | 'canManagePay'> & { photoUrl: string | null };

export type ServiceMapItem = { id: string; name: string; category: ServiceCategory; lat: number; lng: number; rating: number };
export type ServiceMapResult = { items: ServiceMapItem[]; truncated: boolean };

export type ServiceReviewDto = {
  id: string;
  author: UserMini;
  stars: number;
  comment: string | null;
  visitMethod: VisitMethod;
  createdAt: string;
};

export type VisitDto = {
  id: string;
  serviceId: string;
  method: VisitMethod;
  status: VisitStatus;
  distanceM: number | null;
  createdAt: string;
};

export type ServiceQrDto = { code: string; validFor: 'today' };

/** Error codes added in Phase 7. */
export const SERVICE_ERROR_CODES = [
  'SERVICE_DUPLICATE',
  'TOO_FAR',
  'INVALID_QR',
  'VISIT_EXISTS',
  'VISIT_REQUIRED',
  'REVIEW_COOLDOWN',
  'BBOX_TOO_LARGE',
] as const;
