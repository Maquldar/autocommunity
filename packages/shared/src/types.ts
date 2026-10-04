import type { Locale, PrivacyMode, UserRole } from './constants';

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
  plate: string | null;
  isPrimary: boolean;
};

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
};

export type Me = UserPublic & {
  phone: string | null;
  phoneVerified: boolean;
  privacyMode: PrivacyMode;
  receiveSos: boolean;
  role: UserRole;
  locale: Locale;
  onboardingCompleted: boolean;
  warningsCount: number;
};

export type UserMini = { id: string; nickname: string; name: string; avatarUrl: string | null; rating: number };

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
  | 'report_resolved';

export type NotificationDto = {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

export type FriendRequestDto = { id: string; user: UserPublic; createdAt: string };
