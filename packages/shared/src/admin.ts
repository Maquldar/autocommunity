import { z } from 'zod';
import { USER_ROLES } from './constants';
import type { RatingEventDto } from './rating';
import { REPORT_REASONS, REPORT_TARGET_TYPES, type ReportReason, type ReportStatus, type ReportTargetType } from './reviews-reports';
import { idSchema, paginationQuerySchema } from './schemas';
import { SERVICE_CATEGORIES, SERVICE_STATUSES, VISIT_METHODS, VISIT_STATUSES, type ServiceCategory, type ServiceHours, type ServiceStatus, type VisitMethod, type VisitStatus } from './services';
import { SOS_RESPONSE_STATUSES, SOS_STATUSES, SOS_TYPES, type SosResponseStatus, type SosStatus, type SosType } from './sos';
import type { UploadDto, UserMini } from './types';

/* ---------- limits ---------- */

export const ADMIN_LIMITS = {
  noteMin: 3,
  noteMax: 500,
  /** Admin API requests per admin per minute. */
  perMinute: 300,
  /** Items in the "recent" sections of the user detail. */
  recentItems: 20,
} as const;

/** `admin_actions.action` values. */
export const ADMIN_ACTIONS = [
  'user.warn',
  'user.block',
  'user.unblock',
  'user.sos_ban',
  'user.sos_unban',
  'community.delete',
  'sos.mark_fake',
  'report.confirm',
  'report.dismiss',
  'report.remove_content',
  'service.verify',
  'service.reject',
  'visit.approve',
  'visit.reject',
  /* phase 9 */
  'wallet.adjust',
  'wallet.freeze',
  'wallet.unfreeze',
  'vote.remove',
  'violation.approve',
  'violation.reject',
  'violation.uphold',
  'violation.remove',
  /* phase 10 */
  'pay.partner',
  'pay.items',
  'pay.tag_rotate',
] as const;
export type AdminActionKind = (typeof ADMIN_ACTIONS)[number];

/** Antifraud v1 triggers (API.md §6). */
export const FRAUD_FLAG_KINDS = [
  'sos_cancel_streak',
  'duplicate_sos_photo',
  'report_burst',
  'location_teleport',
  'new_account_sos',
  'otp_abuse',
  'reciprocal_sos',
  /* phase 9 */
  'wallet_funnel',
  'vote_burst',
  'violation_rejections',
] as const;
export type FraudFlagKind = (typeof FRAUD_FLAG_KINDS)[number];

/** Antifraud thresholds. Each trigger fires at the stated value ("more than 2" → 3). */
export const ANTIFRAUD = {
  /** Cancelled within `cancelWindowMin` of creation, or marked fake, counted over `cancelStreakDays`. */
  cancelStreakMin: 3,
  cancelWindowMin: 30,
  cancelStreakDays: 7,
  cancelStreakBanHours: 72,
  duplicatePhotoDays: 30,
  reportBurstReporters: 3,
  /** Only reporters with an account at least this old, at least this rating and no dismissed reports count. */
  reportBurstReporterMinAgeDays: 7,
  reportBurstReporterMinRating: 40,
  reportBurstHours: 24,
  reportBurstBlockBelowRating: 30,
  reportBurstBlockHours: 24,
  teleportJumps: 3,
  teleportWindowMin: 60,
  newAccountHours: 24,
  /** "More than 3" lockouts. */
  otpLockoutsMin: 4,
  otpWindowHours: 24,
  /** Two users who helped each other (closed SOS, both directions) this many times within the window. */
  reciprocalSosMin: 2,
  reciprocalSosDays: 7,
  /* phase 9 */
  /** `wallet_funnel`: this many distinct senders with accounts younger than `walletFunnelSenderMaxAgeDays` transfer into one account within `walletFunnelHours`. */
  walletFunnelSenders: 3,
  walletFunnelSenderMaxAgeDays: 7,
  walletFunnelHours: 24,
  /** `vote_burst`: this many downvotes on one user within `voteBurstHours` from "new or low" voters (account < `voteBurstNewAccountDays` or rating < `voteBurstLowRating`). */
  voteBurstDownvotes: 5,
  voteBurstHours: 24,
  voteBurstNewAccountDays: 30,
  voteBurstLowRating: 50,
  /** `violation_rejections`: a submitter's rejected violation submissions reach this count within `violationRejectionsDays`. */
  violationRejectionsMin: 3,
  violationRejectionsDays: 90,
} as const;

/* ---------- request schemas ---------- */

export const adminNoteSchema = z.string().trim().min(ADMIN_LIMITS.noteMin).max(ADMIN_LIMITS.noteMax);
export const adminNoteBodySchema = z.object({ note: adminNoteSchema });
export type AdminNoteInput = z.output<typeof adminNoteBodySchema>;

const futureDate = z.iso
  .datetime({ offset: true })
  .transform((v) => new Date(v))
  .refine((d) => d.getTime() > Date.now(), 'Must be in the future');

export const adminBlockSchema = z.object({ note: adminNoteSchema, until: futureDate.nullable().optional() });
export type AdminBlockInput = z.output<typeof adminBlockSchema>;

export const adminSosBanSchema = z.object({ note: adminNoteSchema, until: futureDate });
export type AdminSosBanInput = z.output<typeof adminSosBanSchema>;

export const adminResolveReportSchema = z.object({
  decision: z.enum(['confirm', 'dismiss']),
  note: adminNoteSchema,
  removeContent: z.boolean().optional().default(false),
});
export type AdminResolveReportInput = z.output<typeof adminResolveReportSchema>;

const q = z.string().trim().min(1).max(60).optional();

export const ADMIN_USER_STATUSES = ['active', 'blocked', 'deleted'] as const;
export type AdminUserStatus = (typeof ADMIN_USER_STATUSES)[number];

export const adminUsersQuerySchema = paginationQuerySchema.extend({ q, status: z.enum(ADMIN_USER_STATUSES).optional() });
export const adminCommunitiesQuerySchema = paginationQuerySchema.extend({ q });
export const adminSosQuerySchema = paginationQuerySchema.extend({ status: z.enum(SOS_STATUSES).optional(), q });
export const adminReportsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['open', 'confirmed', 'dismissed']).optional(),
  targetType: z.enum(REPORT_TARGET_TYPES).optional(),
  q,
});
export const adminFraudFlagsQuerySchema = paginationQuerySchema.extend({ kind: z.enum(FRAUD_FLAG_KINDS).optional(), userId: idSchema.optional() });
export const adminAuditQuerySchema = paginationQuerySchema.extend({ adminId: idSchema.optional(), targetUserId: idSchema.optional() });
export const adminServicesQuerySchema = paginationQuerySchema.extend({ status: z.enum(SERVICE_STATUSES).optional(), q });
export const adminVisitsQuerySchema = paginationQuerySchema.extend({ status: z.enum(VISIT_STATUSES).optional() });

/* ---------- DTOs ---------- */

export type AdminStatsDto = {
  users: { total: number; active7d: number; new7d: number; blocked: number };
  sos: { open: number; last7d: number; closed7d: number; medianFirstResponseSec7d: number | null; fakeRate30d: number };
  reports: { open: number };
  services: { pending: number };
  visits: { pending: number };
  communities: { total: number };
};

export type AdminUserRow = {
  id: string;
  nickname: string | null;
  name: string;
  avatarUrl: string | null;
  phone: string | null;
  role: (typeof USER_ROLES)[number];
  /** `blocked` only while the block is in force (an expired temporary block reads `active`). */
  status: AdminUserStatus;
  rating: number;
  blockedUntil: string | null;
  sosBannedUntil: string | null;
  onboarded: boolean;
  createdAt: string;
  lastActiveAt: string | null;
};

export type AdminActionDto = {
  id: string;
  action: AdminActionKind | string;
  targetType: string;
  targetId: string;
  admin: UserMini;
  targetUser: UserMini | null;
  note: string | null;
  createdAt: string;
};

export type FraudFlagDto = {
  id: string;
  kind: FraudFlagKind | string;
  user: UserMini | null;
  details: Record<string, unknown>;
  createdAt: string;
};

export type AdminUserDetail = {
  user: AdminUserRow & { city: string | null; bio: string | null; phoneVerified: boolean; locale: string };
  counts: { sosCreated: number; helps: number; reportsAgainst: number; reportsFiled: number; warnings: number };
  recentRatingEvents: RatingEventDto[];
  recentAdminActions: AdminActionDto[];
  fraudFlags: FraudFlagDto[];
};

export type AdminCommunityDto = {
  id: string;
  name: string;
  city: string | null;
  isPrivate: boolean;
  memberCount: number;
  owner: UserMini;
  deleted: boolean;
  deletedAt: string | null;
  createdAt: string;
};

export type AdminSosRow = {
  id: string;
  type: SosType;
  status: SosStatus;
  description: string;
  requester: UserMini;
  lat: number;
  lng: number;
  isFake: boolean;
  responsesCount: number;
  createdAt: string;
  closedAt: string | null;
};

export type AdminSosResponse = { id: string; helper: UserMini; status: SosResponseStatus; createdAt: string };

export type AdminSosDetail = AdminSosRow & {
  cancelReason: string | null;
  expiresAt: string;
  radiusM: number;
  photos: UploadDto[];
  responses: AdminSosResponse[];
  dispatchCount: number;
  chatId: string | null;
  reports: AdminReportDto[];
};

/** What a report points at, for the moderation queue. `deleted` when the content is already gone. */
export type ReportTargetPreview = {
  title: string | null;
  text: string | null;
  imageUrl: string | null;
  deleted: boolean;
  /** Post and comment targets: the post to open (`/posts/:id`; the comment's parent post). */
  postId?: string | null;
};

export type AdminReportDto = {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
  reporter: UserMini;
  targetUser: UserMini | null;
  preview: ReportTargetPreview;
};

export type AdminResolveResult = { report: AdminReportDto; resolvedSiblings: number; penaltyApplied: boolean; contentRemoved: boolean };

export type AdminServiceDto = {
  id: string;
  name: string;
  category: ServiceCategory;
  description: string;
  address: string;
  phone: string | null;
  hours: ServiceHours;
  lat: number;
  lng: number;
  status: ServiceStatus;
  rating: number;
  reviewCount: number;
  photos: UploadDto[];
  submittedBy: UserMini | null;
  createdAt: string;
};

export type AdminVisitDto = {
  id: string;
  service: { id: string; name: string; address: string };
  user: UserMini;
  method: VisitMethod;
  status: VisitStatus;
  photo: UploadDto | null;
  createdAt: string;
};

/* ---------- notification payloads ---------- */

/**
 * `admin_warning` payload. `kind`: a manual warning (note shown to the user), a block / SOS ban (manual or
 * automatic), or an SOS marked fake.
 */
export type AdminWarningPayload = {
  kind: 'warning' | 'blocked' | 'sos_ban' | 'fake_sos';
  note: string | null;
  until: string | null;
  automatic: boolean;
  sosId?: string;
};
export type ReportResolvedPayload = { reportId: string; decision: 'confirmed' | 'dismissed'; targetType: ReportTargetType };
export type ServiceStatusPayload = { serviceId: string; serviceName: string; status: 'verified' | 'rejected'; note: string | null };
export type VisitStatusPayload = { visitId: string; serviceId: string; serviceName: string; status: 'verified' | 'rejected'; note: string | null };

/* re-exports used by admin filters */
export const ADMIN_FILTERS = {
  sosStatuses: SOS_STATUSES,
  sosTypes: SOS_TYPES,
  sosResponseStatuses: SOS_RESPONSE_STATUSES,
  reportReasons: REPORT_REASONS,
  reportTargetTypes: REPORT_TARGET_TYPES,
  serviceCategories: SERVICE_CATEGORIES,
  serviceStatuses: SERVICE_STATUSES,
  visitMethods: VISIT_METHODS,
  visitStatuses: VISIT_STATUSES,
} as const;

/** Printable QR for a service: today's code and the URL the QR encodes (`{web origin}/services/{id}?code=`). */
export type AdminServiceQrDto = { code: string; validFor: 'today'; url: string };
