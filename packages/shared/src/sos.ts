import { z } from 'zod';
import { bodyLatSchema, bodyLngSchema, idSchema, paginationQuerySchema } from './schemas';
import type { UploadDto, UserMini, UserPublic } from './types';

/* ---------- enums ---------- */

export const SOS_TYPES = ['flat_tire', 'battery', 'fuel', 'stuck', 'breakdown', 'accident', 'tow', 'other'] as const;
export type SosType = (typeof SOS_TYPES)[number];

export const SOS_STATUSES = ['created', 'accepted', 'in_progress', 'closed', 'cancelled', 'expired'] as const;
export type SosStatus = (typeof SOS_STATUSES)[number];
/** Statuses in which an SOS is "open" (visible on maps, can be helped). */
export const SOS_OPEN_STATUSES: readonly SosStatus[] = ['created', 'accepted', 'in_progress'];

export const SOS_RESPONSE_STATUSES = ['offered', 'accepted', 'arrived', 'withdrawn', 'declined'] as const;
export type SosResponseStatus = (typeof SOS_RESPONSE_STATUSES)[number];

export type SosRole = 'requester' | 'helper' | 'viewer';

/* ---------- limits ---------- */

export const SOS_LIMITS = {
  descriptionMax: 500,
  photosMax: 4,
  /** SOS a user may create per rolling 24 h. */
  perDay: 3,
  ttlSec: 2 * 3600,
  /** Dispatch radii: immediately, then after +5 and +10 minutes while nobody accepted. */
  radiiM: [5000, 10000, 20000] as const,
  expandDelaySec: 300,
  dispatchMaxPerStep: 20,
  freshLocationMin: 15,
  /** Viewers within this distance (last location) may open an SOS; also the /sos/nearby radius. */
  visibleRadiusM: 20000,
  maxActiveOffers: 10,
  maxAcceptedHelpers: 3,
  /** Public share link stays valid this long after the SOS ended. */
  shareGraceSec: 3600,
  publicPerMinute: 60,
} as const;

/* ---------- DTOs ---------- */

export type SosResponseDto = {
  id: string;
  helper: UserPublic;
  status: SosResponseStatus;
  /** Helper ↔ SOS distance; null if unknown or the helper is in hidden mode. */
  distanceM: number | null;
  /** Only for the requester, only for accepted/arrived helpers of an open SOS. */
  helperPhone: string | null;
  createdAt: string;
};

export type SosDto = {
  id: string;
  type: SosType;
  description: string;
  photos: UploadDto[];
  lat: number;
  lng: number;
  status: SosStatus;
  requester: UserPublic;
  /** From the viewer's last location (or the query point for /sos/nearby); null if unknown. */
  distanceM: number | null;
  radiusM: number;
  createdAt: string;
  /** When the SOS ended (closed, cancelled or expired). */
  closedAt: string | null;
  expiresAt: string;
  /** Requester: all responses. Others: only their own. */
  responses: SosResponseDto[];
  myRole: SosRole;
  contactPhone: string | null;
  chatId: string | null;
  /** True when the viewer has at least one review left to write for this SOS (closed, within 14 days). */
  canReview: boolean;
  /** Who the viewer can still review for this SOS. */
  reviewTargets: UserMini[];
};

export type SosMapItem = { id: string; type: SosType; lat: number; lng: number; status: SosStatus; createdAt: string };

export type PublicSosDto = {
  type: SosType;
  status: SosStatus;
  lat: number;
  lng: number;
  requesterName: string;
  /** First accepted helper (kept for the frozen contract); all of them in `helperNicknames`. */
  helperNickname: string | null;
  helperNicknames: string[];
  updatedAt: string;
};

/* ---------- request schemas ---------- */

export const createSosSchema = z.object({
  type: z.enum(SOS_TYPES),
  description: z.string().trim().max(SOS_LIMITS.descriptionMax).default(''),
  photoUploadIds: z.array(idSchema).max(SOS_LIMITS.photosMax).default([]),
  lat: bodyLatSchema,
  lng: bodyLngSchema,
  sharePhone: z.boolean(),
});
export type CreateSosInput = z.output<typeof createSosSchema>;

export const cancelSosSchema = z.object({ reason: z.string().trim().max(SOS_LIMITS.descriptionMax).optional() });

/** Query coordinates (strings from the URL). */
/** Optional hints: used only when within 1 km of the viewer's stored location. */
export const sosNearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

export const sosHistoryQuerySchema = paginationQuerySchema;

/* realtime */
export type SosSystemMessageKey =
  | 'sos.chat_created'
  | 'sos.helper_accepted'
  | 'sos.helper_arrived'
  | 'sos.helper_withdrew'
  | 'sos.closed'
  | 'sos.cancelled';

