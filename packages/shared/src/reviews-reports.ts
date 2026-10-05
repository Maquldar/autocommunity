import { z } from 'zod';
import { idSchema, paginationQuerySchema } from './schemas';
import type { UserMini } from './types';

/* ---------- reviews ---------- */

export const REVIEW_LIMITS = { commentMax: 500, windowDays: 14 } as const;

export type ReviewDto = { id: string; author: UserMini; stars: number; comment: string | null; refType: 'sos'; createdAt: string };

export const createSosReviewSchema = z.object({
  targetUserId: idSchema,
  stars: z.number().int().min(1).max(5),
  comment: z
    .string()
    .trim()
    .max(REVIEW_LIMITS.commentMax)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type CreateSosReviewInput = z.output<typeof createSosReviewSchema>;

/* ---------- reports ---------- */

export const REPORT_TARGET_TYPES = ['user', 'message', 'post', 'comment', 'sos', 'community', 'service'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];
export const REPORT_REASONS = ['spam', 'fake_sos', 'harassment', 'fraud', 'inappropriate', 'dangerous', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export type ReportStatus = 'open' | 'confirmed' | 'dismissed';
export const REPORT_LIMITS = { perDay: 10, detailsMax: 500 } as const;

export type ReportDto = {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export const createReportSchema = z
  .object({
    targetType: z.enum(REPORT_TARGET_TYPES),
    targetId: idSchema,
    reason: z.enum(REPORT_REASONS),
    details: z
      .string()
      .trim()
      .max(REPORT_LIMITS.detailsMax)
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .refine((r) => r.reason !== 'fake_sos' || r.targetType === 'sos', { path: ['reason'], message: 'fake_sos can only be used for SOS reports' });
export type CreateReportInput = z.output<typeof createReportSchema>;

export const reportsQuerySchema = paginationQuerySchema;
