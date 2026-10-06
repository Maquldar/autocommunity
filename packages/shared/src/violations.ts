import { z } from 'zod';
import { idSchema, INVISIBLE_RE, paginationQuerySchema } from './schemas';
import type { UploadDto, UserMini } from './types';

/*
 * Phase 9 — vehicle violations. Most traffic offences fall under КоАП РК, the serious ones under УК РК.
 * Article numbers are NOT hardcoded: a category plus an optional free-text `article` (e.g. "ст. 610 КоАП").
 */

export const VIOLATION_CATEGORIES = [
  'speeding',
  'red_light',
  'drunk_driving',
  'wrong_lane',
  'no_license',
  'accident_fled',
  'dangerous_driving',
  'parking',
  'other',
] as const;
export type ViolationCategory = (typeof VIOLATION_CATEGORIES)[number];

export const VIOLATION_CODE_TYPES = ['koap', 'uk'] as const;
export type ViolationCodeType = (typeof VIOLATION_CODE_TYPES)[number];

/**
 * pending → approved | rejected (admin); pending | approved → disputed (owner);
 * disputed → approved (uphold) | removed (admin). Only `approved` is public.
 */
export const VIOLATION_STATUSES = ['pending', 'approved', 'rejected', 'disputed', 'removed'] as const;
export type ViolationStatus = (typeof VIOLATION_STATUSES)[number];

export const VIOLATION_LIMITS = {
  photosMin: 1,
  photosMax: 3,
  articleMax: 60,
  descriptionMin: 10,
  descriptionMax: 1000,
  disputeMin: 10,
  disputeMax: 1000,
  /** Submissions per submitter per rolling 24 h. */
  perDay: 5,
  /** `occurredAt` at most this many days in the past (and not in the future). */
  maxAgeDays: 3 * 365,
  /** Non-owners must have an account at least this old and at least this rating. */
  submitterMinAccountAgeDays: 7,
  submitterMinRating: 40,
} as const;

const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((v) => !INVISIBLE_RE.test(v), 'Contains invalid characters');

export const createViolationSchema = z.object({
  category: z.enum(VIOLATION_CATEGORIES),
  codeType: z.enum(VIOLATION_CODE_TYPES),
  article: z
    .string()
    .trim()
    .max(VIOLATION_LIMITS.articleMax)
    .refine((v) => !INVISIBLE_RE.test(v) && !/[\n\t]/.test(v), 'Contains invalid characters')
    .optional()
    .transform((v) => (v ? v : undefined)),
  occurredAt: z.iso
    .datetime({ offset: true })
    .transform((v) => new Date(v))
    .refine((d) => d.getTime() <= Date.now() + 5 * 60_000, 'Must not be in the future')
    .refine((d) => d.getTime() >= Date.now() - VIOLATION_LIMITS.maxAgeDays * 24 * 3600 * 1000, 'Too long ago'),
  description: text(VIOLATION_LIMITS.descriptionMin, VIOLATION_LIMITS.descriptionMax),
  photoUploadIds: z
    .array(idSchema)
    .min(VIOLATION_LIMITS.photosMin)
    .max(VIOLATION_LIMITS.photosMax)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate photos'),
});
export type CreateViolationInput = z.output<typeof createViolationSchema>;

export const disputeViolationSchema = z.object({ text: text(VIOLATION_LIMITS.disputeMin, VIOLATION_LIMITS.disputeMax) });
export type DisputeViolationInput = z.output<typeof disputeViolationSchema>;

export const violationsQuerySchema = paginationQuerySchema;

export type ViolationVehicleRef = { id: string; brand: string; model: string; year: number };

/** The submitter is never part of this DTO (`submittedByMe` only tells the caller about themselves). */
export type ViolationDto = {
  id: string;
  vehicle: ViolationVehicleRef;
  category: ViolationCategory;
  codeType: ViolationCodeType;
  article: string | null;
  occurredAt: string;
  description: string;
  photos: UploadDto[];
  status: ViolationStatus;
  /** The owner's dispute; only the owner (and admins) see it, others get null. */
  dispute: { text: string; createdAt: string } | null;
  submittedByMe: boolean;
  /** The caller owns the vehicle and the status allows a dispute (pending or approved, not yet disputed). */
  canDispute: boolean;
  createdAt: string;
  /** When an admin last decided (approve / reject / resolve). */
  decidedAt: string | null;
};

/* ---------- admin ---------- */

export const adminViolationsQuerySchema = paginationQuerySchema.extend({ status: z.enum(VIOLATION_STATUSES).optional() });
export const adminResolveDisputeSchema = z.object({ decision: z.enum(['uphold', 'remove']), note: z.string().trim().min(3).max(500) });
export type AdminResolveDisputeInput = z.output<typeof adminResolveDisputeSchema>;

export type AdminViolationDto = Omit<ViolationDto, 'submittedByMe' | 'canDispute' | 'dispute'> & {
  owner: UserMini;
  submitter: UserMini;
  dispute: { text: string; createdAt: string } | null;
  /** The submitter's rejected submissions (all time), for spotting serial false reports. */
  submitterRejectedCount: number;
  /** Penalty currently applied through the rating ledger. */
  penaltyApplied: boolean;
  decisionNote: string | null;
};

/* ---------- notification payloads ---------- */

/** To the vehicle owner when someone else submits a violation on their vehicle. */
export type ViolationReportedPayload = { violationId: string; vehicleId: string; category: ViolationCategory; vehicle: string };
/** To the owner (and the submitter, when it isn't the owner) after an admin decision. */
export type ViolationStatusPayload = {
  violationId: string;
  vehicleId: string;
  category: ViolationCategory;
  status: 'approved' | 'rejected' | 'removed';
  role: 'owner' | 'submitter';
};
