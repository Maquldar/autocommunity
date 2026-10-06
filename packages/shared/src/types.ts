import type { ChatReadEvent, ChatTypingEvent, MessageDeletedEvent, MessageDto } from './communities';
import type { Locale, PrivacyMode, UserRole } from './constants';
import type { VehicleBodyType, VehicleColor, VehicleDrive, VehicleFuel, VehicleTransmission } from './schemas';
import type { SosDto } from './sos';
import type { RatingTier } from './tiers';

export type Paginated<T> = { items: T[]; nextCursor: string | null };

export type ApiErrorBody = { error: { code: string; message: string; details?: unknown } };

export type UploadDto = {
  id: string;
  url: string;
  thumbUrl: string | null;
  mime: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  sizeBytes: number;
};

export type VehicleDto = {
  id: string;
  brand: string;
  model: string;
  year: number;
  /** Owner and accepted friends only, else null. Never on the map. */
  plate: string | null;
  isPrimary: boolean;
  /* phase 9 details (null = not set) */
  engineVolumeL: number | null;
  fuel: VehicleFuel | null;
  transmission: VehicleTransmission | null;
  drive: VehicleDrive | null;
  bodyType: VehicleBodyType | null;
  color: VehicleColor | null;
  mileageKm: number | null;
  description: string | null;
  photos: UploadDto[];
};

/** The owner's own view (`/me/vehicles`): adds the VIN, which is never part of any other DTO. */
export type OwnVehicleDto = VehicleDto & { vin: string | null };

/** `GET /vehicles/:id`: a vehicle with its owner and the count of approved violations. */
export type VehicleDetailDto = VehicleDto & { owner: UserMini; approvedViolations: number };

export type Relation = 'self' | 'none' | 'request_out' | 'request_in' | 'friend';

export type UserPublic = {
  id: string;
  nickname: string;
  name: string;
  avatarUrl: string | null;
  city: string | null;
  bio: string | null;
  rating: number;
  createdAt: string;
  primaryVehicle: VehicleDto | null;
  relation: Relation;
  status: 'active' | 'blocked';
  /* phase 9 */
  /** Active premium: the badge. */
  isPremium: boolean;
  /** Profile frame to draw around the avatar on the profile page (premium → 'premium'). */
  profileFrame: 'premium' | null;
  /** `tierForRating(rating)`. */
  tier: RatingTier;
};

/** `nickname` is null until onboarding sets it (UserPublic is only rendered for onboarded users). */
export type Me = Omit<UserPublic, 'nickname'> & {
  nickname: string | null;
  phone: string | null;
  phoneVerified: boolean;
  privacyMode: PrivacyMode;
  receiveSos: boolean;
  role: UserRole;
  locale: Locale;
  onboardingCompleted: boolean;
  warningsCount: number;
};

/**
 * Phase 9 adds `isPremium`. The tier is not carried: compute it with `tierForRating(rating)`. Snapshots stored
 * in notification payloads before Phase 9 lack `isPremium` — treat a missing value as false.
 */
export type UserMini = { id: string; nickname: string; name: string; avatarUrl: string | null; rating: number; isPremium: boolean };

export type AuthProviders = {
  google: { clientId: string } | null;
  apple: { clientId: string; redirectUri: string } | null;
  devOtp: boolean;
};

export type OtpRequestResult = { retryAfterSec: number; devCode?: string };
export type AuthResult = { accessToken: string; user: Me; isNew: boolean };

/* phase 2 */

export type MapUser = {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  rating: number;
  vehicle: { brand: string; model: string } | null;
  lat: number;
  lng: number;
  approximate: boolean;
  relation: 'friend' | 'community' | 'public';
  updatedAt: string;
};

export type NotificationType =
  | 'friend_request'
  | 'friend_accepted'
  | 'community_request'
  | 'community_approved'
  | 'community_role'
  | 'sos_nearby'
  | 'sos_response'
  | 'sos_accepted'
  | 'sos_status'
  | 'review_received'
  | 'message'
  | 'admin_warning'
  | 'event_new'
  | 'event_reminder'
  | 'post_comment'
  | 'post_like'
  | 'service_status'
  | 'visit_status'
  | 'report_resolved'
  /* phase 9 */
  | 'wallet_received'
  | 'wallet_admin'
  | 'premium_reminder'
  | 'premium_renewed'
  | 'premium_expired'
  | 'vote_received'
  | 'violation_reported'
  | 'violation_status'
  /* phase 10 */
  | 'purchase_paid';

export type NotificationDto = {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

export type FriendRequestDto = { id: string; user: UserPublic; createdAt: string };

/* realtime (Socket.IO namespace /rt) */

export type ServerToClientEvents = {
  'notification:new': (n: NotificationDto) => void;
  'notification:count': (p: { count: number }) => void;
  'friends:changed': (p: Record<string, never>) => void;
  'session:revoked': (p: Record<string, never>) => void;
  /* phase 3 */
  'message:new': (m: MessageDto) => void;
  'message:deleted': (p: MessageDeletedEvent) => void;
  'chat:typing': (p: ChatTypingEvent) => void;
  'chat:read': (p: ChatReadEvent) => void;
  /** The user's chat list or community memberships changed (joined, left, removed, approved, deleted). */
  'chats:changed': (p: Record<string, never>) => void;
  /* phase 4 — payloads are rendered for the receiving user (responses, phones, role) */
  'sos:new': (s: SosDto) => void;
  'sos:update': (s: SosDto) => void;
};

export type ClientToServerEvents = {
  'chat:join': (p: { chatId: string }, ack?: (r: { ok: boolean }) => void) => void;
  'chat:leave': (p: { chatId: string }) => void;
  'chat:typing': (p: { chatId: string }) => void;
};

export type PushPayload = { title: string; body: string; url: string; tag: string };
