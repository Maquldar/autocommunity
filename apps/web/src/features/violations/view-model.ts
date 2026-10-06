import {
  createViolationSchema,
  disputeViolationSchema,
  VIOLATION_LIMITS,
  type Me,
  type ViolationCategory,
  type ViolationCodeType,
  type ViolationDto,
  type ViolationStatus,
} from '@autoc/shared';
import { getRetryAfterSec, isApiError, numberDetail } from '@/lib/api/errors';

const DAY_MS = 24 * 3600 * 1000;

export type StatusTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'outline';

/** Approved = confirmed (danger: it costs the owner rating), pending = warning, disputed = primary. */
export const VIOLATION_STATUS_TONE: Record<ViolationStatus, StatusTone> = {
  pending: 'warning',
  approved: 'danger',
  disputed: 'primary',
  rejected: 'neutral',
  removed: 'outline',
};

/** Which code a category usually falls under (a default for the form; the reporter can change it). */
export function defaultCodeType(category: ViolationCategory): ViolationCodeType {
  return category === 'drunk_driving' || category === 'accident_fled' ? 'uk' : 'koap';
}

/** `<input type="date">` value → ISO `occurredAt`: noon that day, or now for today (never in the future). */
export function occurredAtFromDate(date: string, now = new Date()): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const local = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  if (Number.isNaN(local.getTime())) return null;
  return (local.getTime() > now.getTime() ? now : local).toISOString();
}

/** yyyy-mm-dd of a Date in local time (for the date input's max/min). */
export function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const minViolationDate = (now = new Date()) => toDateInput(new Date(now.getTime() - VIOLATION_LIMITS.maxAgeDays * DAY_MS + DAY_MS));

export type ViolationDraft = {
  category: ViolationCategory | null;
  codeType: ViolationCodeType;
  article: string;
  date: string;
  description: string;
  photoIds: string[];
};

export type ViolationFormErrorKey =
  | 'categoryRequired'
  | 'dateRequired'
  | 'dateRange'
  | 'descriptionShort'
  | 'descriptionLong'
  | 'invalidChars'
  | 'photosRequired'
  | 'photosTooMany'
  | 'articleLong';
export type ViolationFieldErrors = Partial<Record<'category' | 'article' | 'date' | 'description' | 'photos', ViolationFormErrorKey>>;

/**
 * Validates the draft with the shared `createViolationSchema` (never duplicating its rules) and maps the
 * issues to message keys (`violations.form.errors.*`).
 */
export function checkViolationDraft(draft: ViolationDraft, now = new Date()): { ok: true; body: { category: ViolationCategory; codeType: ViolationCodeType; article?: string; occurredAt: string; description: string; photoUploadIds: string[] } } | { ok: false; errors: ViolationFieldErrors } {
  const occurredAt = occurredAtFromDate(draft.date, now);
  const errors: ViolationFieldErrors = {};
  if (!draft.category) errors.category = 'categoryRequired';
  if (!occurredAt) errors.date = 'dateRequired';
  const parsed = createViolationSchema.safeParse({
    category: draft.category ?? 'other',
    codeType: draft.codeType,
    article: draft.article,
    occurredAt: occurredAt ?? now.toISOString(),
    description: draft.description,
    photoUploadIds: draft.photoIds,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === 'description' && !errors.description) {
        errors.description = draft.description.trim().length < VIOLATION_LIMITS.descriptionMin ? 'descriptionShort' : draft.description.trim().length > VIOLATION_LIMITS.descriptionMax ? 'descriptionLong' : 'invalidChars';
      } else if (field === 'photoUploadIds' && !errors.photos) {
        errors.photos = draft.photoIds.length < VIOLATION_LIMITS.photosMin ? 'photosRequired' : 'photosTooMany';
      } else if (field === 'article' && !errors.article) {
        errors.article = draft.article.trim().length > VIOLATION_LIMITS.articleMax ? 'articleLong' : 'invalidChars';
      } else if (field === 'occurredAt' && !errors.date) {
        errors.date = 'dateRange';
      }
    }
  }
  if (Object.keys(errors).length || !parsed.success || !draft.category || !occurredAt) return { ok: false, errors };
  return {
    ok: true,
    body: {
      category: draft.category,
      codeType: draft.codeType,
      article: parsed.data.article,
      occurredAt,
      description: parsed.data.description,
      photoUploadIds: parsed.data.photoUploadIds,
    },
  };
}

export function checkDisputeText(text: string): 'short' | 'long' | 'invalid' | null {
  const parsed = disputeViolationSchema.safeParse({ text });
  if (parsed.success) return null;
  const len = text.trim().length;
  if (len < VIOLATION_LIMITS.disputeMin) return 'short';
  if (len > VIOLATION_LIMITS.disputeMax) return 'long';
  return 'invalid';
}

/** Who may submit (API.md §9.4): the owner always; others need an account ≥ 7 days and rating ≥ 40. */
export function submitEligibility(me: Pick<Me, 'id' | 'createdAt' | 'rating'>, ownerId: string, now = Date.now()): { key: 'ok' } | { key: 'accountTooNew'; days: number } | { key: 'ratingTooLow'; min: number } {
  if (me.id === ownerId) return { key: 'ok' };
  const ageDays = (now - Date.parse(me.createdAt)) / DAY_MS;
  if (Number.isFinite(ageDays) && ageDays < VIOLATION_LIMITS.submitterMinAccountAgeDays) {
    return { key: 'accountTooNew', days: Math.max(1, Math.ceil(VIOLATION_LIMITS.submitterMinAccountAgeDays - ageDays)) };
  }
  if (me.rating < VIOLATION_LIMITS.submitterMinRating) return { key: 'ratingTooLow', min: VIOLATION_LIMITS.submitterMinRating };
  return { key: 'ok' };
}

/** Server errors of submit / dispute → `violations.errors.*` (null → the shared mapping). */
export type ViolationErrorKey = 'accountTooNew' | 'ratingTooLow' | 'rateLimited' | 'invalidUpload' | 'alreadyDisputed' | 'invalidState' | 'notOwner' | 'notFound';

export function violationError(error: unknown): { key: ViolationErrorKey; values?: Record<string, number> } | null {
  if (!isApiError(error)) return null;
  switch (error.code) {
    case 'ACCOUNT_TOO_NEW': {
      const sec = getRetryAfterSec(error);
      return { key: 'accountTooNew', values: { days: sec === null ? (numberDetail(error, 'minDays') ?? VIOLATION_LIMITS.submitterMinAccountAgeDays) : Math.max(1, Math.ceil(sec / 86_400)) } };
    }
    case 'RATING_TOO_LOW':
      return { key: 'ratingTooLow', values: { min: numberDetail(error, 'min') ?? VIOLATION_LIMITS.submitterMinRating } };
    case 'RATE_LIMITED':
      return { key: 'rateLimited', values: { max: VIOLATION_LIMITS.perDay } };
    case 'INVALID_UPLOAD':
      return { key: 'invalidUpload' };
    case 'ALREADY_DISPUTED':
      return { key: 'alreadyDisputed' };
    case 'VIOLATION_INVALID_STATE':
      return { key: 'invalidState' };
    case 'FORBIDDEN':
      return { key: 'notOwner' };
    case 'NOT_FOUND':
      return { key: 'notFound' };
    default:
      return null;
  }
}

/** The owner sees pending/disputed ones with their status; everyone else sees approved only (server-filtered). */
export function showsStatus(v: Pick<ViolationDto, 'status'>, viewerIsOwner: boolean, submittedList = false): boolean {
  return submittedList || viewerIsOwner || v.status !== 'approved';
}
