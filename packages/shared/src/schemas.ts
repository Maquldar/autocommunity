import { z } from 'zod';
import { CITIES, LIMITS, LOCALES, PRIVACY_MODES, UPLOAD_PURPOSES } from './constants';
import { normalizePhone } from './phone';

/* ---------- primitives ---------- */

export const idSchema = z.uuid();

export const phoneSchema = z
  .string()
  .trim()
  .min(5)
  .max(20)
  .transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'Invalid phone number' });
      return z.NEVER;
    }
    return n;
  });

export const otpCodeSchema = z.string().regex(new RegExp(`^\\d{${LIMITS.otpLength}}$`), 'Code must be 6 digits');

/** Query-string coordinates (strings coerced to numbers). */
export const latSchema = z.coerce.number().min(-90).max(90);
export const lngSchema = z.coerce.number().min(-180).max(180);
/** JSON-body coordinates: real numbers only (no string coercion). */
export const bodyLatSchema = z.number().min(-90).max(90);
export const bodyLngSchema = z.number().min(-180).max(180);

export const paginationQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.pageMax).default(LIMITS.pageDefault),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** `minLng,minLat,maxLng,maxLat` */
export const bboxSchema = z
  .string()
  .transform((v, ctx) => {
    const parts = v.split(',').map(Number);
    const [minLng, minLat, maxLng, maxLat] = parts;
    const valid =
      parts.length === 4 &&
      parts.every(Number.isFinite) &&
      minLng! >= -180 && maxLng! <= 180 && minLat! >= -90 && maxLat! <= 90 &&
      minLng! < maxLng! && minLat! < maxLat!;
    if (!valid) {
      ctx.addIssue({ code: 'custom', message: 'bbox must be minLng,minLat,maxLng,maxLat' });
      return z.NEVER;
    }
    return { minLng: minLng!, minLat: minLat!, maxLng: maxLng!, maxLat: maxLat! };
  });
export type Bbox = z.output<typeof bboxSchema>;

const csvIds = z
  .string()
  .transform((v) => v.split(',').filter(Boolean))
  .pipe(z.array(z.uuid()).max(20));

const boolQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

/* ---------- auth ---------- */

export const otpRequestSchema = z.object({ phone: phoneSchema });
export const otpVerifySchema = z.object({ phone: phoneSchema, code: otpCodeSchema });
export const googleAuthSchema = z.object({ idToken: z.string().min(10).max(4096) });
export const appleAuthSchema = z.object({
  idToken: z.string().min(10).max(4096),
  name: z.string().trim().max(LIMITS.nameMax).optional(),
});

/* ---------- profile ---------- */

/**
 * Invisible or layout-changing characters that enable look-alike names: C0/C1 controls (newline and tab
 * are handled per field), zero-width space/non-joiner, bidi marks and overrides, word joiners, BOM, soft
 * hyphen. ZWJ (U+200D) stays allowed because emoji sequences need it.
 */
export const INVISIBLE_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/;
const LINE_BREAK_RE = /[\t\n]/;

/** Display name: single line, no invisible characters, at least one letter or digit. */
export const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.nameMax)
  .refine((v) => !INVISIBLE_RE.test(v) && !LINE_BREAK_RE.test(v), 'Contains invalid characters')
  .refine((v) => /[\p{L}\p{N}]/u.test(v), 'Must contain a letter or digit');

export const bioSchema = z
  .string()
  .trim()
  .max(LIMITS.bioMax)
  .refine((v) => !INVISIBLE_RE.test(v), 'Contains invalid characters');

export const nicknameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(LIMITS.nicknameMin)
  .max(LIMITS.nicknameMax)
  .regex(/^[a-z0-9_.]+$/, 'Only latin letters, digits, _ and .')
  .refine((v) => /[a-z0-9]/.test(v), 'Must contain a letter or digit');

export const citySchema = z.enum(CITIES);

export const updateMeSchema = z
  .object({
    name: nameSchema,
    nickname: nicknameSchema,
    city: citySchema.nullable(),
    bio: bioSchema.nullable(),
    avatarUploadId: idSchema.nullable(),
    locale: z.enum(LOCALES),
  })
  .partial();
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export const updateSettingsSchema = z
  .object({
    privacyMode: z.enum(PRIVACY_MODES),
    receiveSos: z.boolean(),
  })
  .partial();
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export const deleteAccountSchema = z.object({ confirm: z.literal('DELETE') });

/* ---------- vehicles ---------- */

const currentYear = () => new Date().getUTCFullYear();

export const vehicleSchema = z.object({
  brand: z.string().trim().min(1).max(LIMITS.vehicleTextMax),
  model: z.string().trim().min(1).max(LIMITS.vehicleTextMax),
  year: z.coerce
    .number()
    .int()
    .min(LIMITS.minVehicleYear)
    .refine((y) => y <= currentYear() + 1, 'Year is in the future'),
  plate: z
    .string()
    .trim()
    .toUpperCase()
    .max(LIMITS.plateMax)
    .regex(/^[A-Z0-9 -]*$/, 'Latin letters and digits only')
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  isPrimary: z.boolean().optional(),
});
export const updateVehicleSchema = vehicleSchema.partial();
/**
 * JSON bodies of POST/PATCH /me/vehicles: like `vehicleSchema` (which coerces the year so web forms can use
 * it) but the year must be a real number.
 */
export const vehicleBodySchema = vehicleSchema.extend({
  year: z
    .number()
    .int()
    .min(LIMITS.minVehicleYear)
    .refine((y) => y <= currentYear() + 1, 'Year is in the future'),
});
export const updateVehicleBodySchema = vehicleBodySchema.partial();
export type VehicleInput = z.infer<typeof vehicleSchema>;

/* ---------- users ---------- */

export const userSearchQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(2).max(40),
});

/* ---------- uploads ---------- */

export const uploadPurposeSchema = z.object({ purpose: z.enum(UPLOAD_PURPOSES) });

/**
 * Text fields of POST /uploads. `purpose` may also be sent as the `?purpose=` query parameter (preferred:
 * the server then applies the per-kind size limit while streaming); the query value wins.
 * durationSec is client-measured and clamped server-side.
 */
export const uploadBodySchema = uploadPurposeSchema.extend({
  durationSec: z.coerce.number().min(0).max(86_400).optional(),
});
export type UploadBody = z.infer<typeof uploadBodySchema>;

/* ---------- location & map (phase 2) ---------- */

export const updateLocationSchema = z.object({
  lat: bodyLatSchema,
  lng: bodyLngSchema,
  accuracyM: z.number().min(0).max(100_000).optional(),
});

export const mapUsersQuerySchema = z.object({
  bbox: bboxSchema,
  communityIds: csvIds.optional(),
  friends: boolQuery.optional(),
  brand: z.string().trim().min(1).max(LIMITS.vehicleTextMax).optional(),
});
export type MapUsersQuery = z.output<typeof mapUsersQuerySchema>;

/* ---------- friends (phase 2) ---------- */

export const friendRequestSchema = z.object({ userId: idSchema });
export const friendRequestsQuerySchema = paginationQuerySchema.extend({ direction: z.enum(['in', 'out']) });

/* ---------- push (phase 2) ---------- */

export const pushSubscriptionSchema = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(5).max(100) }),
});
export const pushUnsubscribeSchema = z.object({ endpoint: z.url().max(1000) });
