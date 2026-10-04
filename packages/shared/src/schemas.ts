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

export const latSchema = z.coerce.number().min(-90).max(90);
export const lngSchema = z.coerce.number().min(-180).max(180);

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
export const appleAuthSchema = z.object({ idToken: z.string().min(10).max(4096), name: z.string().trim().max(LIMITS.nameMax).optional() });

/* ---------- profile ---------- */

export const nicknameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(LIMITS.nicknameMin)
  .max(LIMITS.nicknameMax)
  .regex(/^[a-z0-9_.]+$/, 'Only latin letters, digits, _ and .');

export const citySchema = z.enum(CITIES);

export const updateMeSchema = z
  .object({
    name: z.string().trim().min(1).max(LIMITS.nameMax),
    nickname: nicknameSchema,
    city: citySchema.nullable(),
    bio: z.string().trim().max(LIMITS.bioMax).nullable(),
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
export type VehicleInput = z.infer<typeof vehicleSchema>;

/* ---------- users ---------- */

export const userSearchQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(2).max(40),
});

/* ---------- uploads ---------- */

export const uploadPurposeSchema = z.object({ purpose: z.enum(UPLOAD_PURPOSES) });

/** Multipart text fields of POST /uploads. durationSec is client-measured and clamped server-side. */
export const uploadBodySchema = uploadPurposeSchema.extend({
  durationSec: z.coerce.number().min(0).max(86_400).optional(),
});
export type UploadBody = z.infer<typeof uploadBodySchema>;

/* ---------- location & map (phase 2) ---------- */

export const updateLocationSchema = z.object({
  lat: latSchema,
  lng: lngSchema,
  accuracyM: z.coerce.number().min(0).max(100_000).optional(),
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
