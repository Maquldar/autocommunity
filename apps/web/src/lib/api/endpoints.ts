import type {
  AuthProviders,
  AuthResult,
  FriendRequestDto,
  MapUser,
  Me,
  NotificationDto,
  Paginated,
  OtpRequestResult,
  UpdateMeInput,
  UpdateSettingsInput,
  UploadDto,
  UploadPurpose,
  UserPublic,
  VehicleDto,
  VehicleInput,
} from '@autoc/shared';
import type { ApiClient } from './client';

/** Wire types: what the client sends. Server-side zod applies the same schemas again. */
export type VehicleBody = Omit<VehicleInput, 'plate'> & { plate?: string | null };

export type PageParams = { cursor?: string | null; limit?: number };
export type MapUsersParams = { bbox: string; friends?: boolean; brand?: string; communityIds?: string[] };
export type MapUsersResult = { items: MapUser[]; truncated: boolean };
export type FriendRequestResult = { id: string; status: string };
export type PushSubscriptionBody = { endpoint: string; keys: { p256dh: string; auth: string } };

/** Builds `?a=1&b=2` from defined, non-empty values. */
export function queryString(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const page = ({ cursor, limit }: PageParams = {}) => ({ cursor: cursor ?? undefined, limit });

/** Every Phase 1 and Phase 2 endpoint from API.md §1–2, typed with the shared DTOs. */
export function createEndpoints({ request }: ApiClient) {
  return {
    auth: {
      providers: () => request<AuthProviders>('/auth/providers', { auth: false }),
      requestOtp: (phone: string) => request<OtpRequestResult>('/auth/otp/request', { method: 'POST', json: { phone }, auth: false }),
      verifyOtp: (phone: string, code: string) =>
        request<AuthResult>('/auth/otp/verify', { method: 'POST', json: { phone, code }, auth: false }),
      google: (idToken: string) => request<AuthResult>('/auth/google', { method: 'POST', json: { idToken }, auth: false }),
      apple: (idToken: string, name?: string) =>
        request<AuthResult>('/auth/apple', { method: 'POST', json: { idToken, name }, auth: false }),
      logoutAll: () => request<void>('/auth/logout-all', { method: 'POST' }),
    },
    me: {
      get: () => request<Me>('/me'),
      update: (input: UpdateMeInput) => request<Me>('/me', { method: 'PATCH', json: input }),
      updateSettings: (input: UpdateSettingsInput) => request<Me>('/me/settings', { method: 'PATCH', json: input }),
      completeOnboarding: () => request<Me>('/me/onboarding/complete', { method: 'POST' }),
      requestPhone: (phone: string) => request<OtpRequestResult>('/me/phone/request', { method: 'POST', json: { phone } }),
      verifyPhone: (phone: string, code: string) => request<Me>('/me/phone/verify', { method: 'POST', json: { phone, code } }),
      remove: () => request<void>('/me', { method: 'DELETE', json: { confirm: 'DELETE' } }),
    },
    vehicles: {
      list: () => request<VehicleDto[]>('/me/vehicles'),
      create: (input: VehicleBody) => request<VehicleDto>('/me/vehicles', { method: 'POST', json: input }),
      update: (id: string, input: Partial<VehicleBody>) =>
        request<VehicleDto>(`/me/vehicles/${encodeURIComponent(id)}`, { method: 'PATCH', json: input }),
      remove: (id: string) => request<void>(`/me/vehicles/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    },
    users: {
      get: (id: string) => request<UserPublic>(`/users/${encodeURIComponent(id)}`),
      vehicles: (id: string) => request<VehicleDto[]>(`/users/${encodeURIComponent(id)}/vehicles`),
      search: (q: string, params?: PageParams, signal?: AbortSignal) =>
        request<Paginated<UserPublic>>(`/users${queryString({ q, ...page(params) })}`, { signal }),
    },
    location: {
      update: (input: { lat: number; lng: number; accuracyM?: number }) =>
        request<void>('/me/location', { method: 'PUT', json: input }),
      remove: () => request<void>('/me/location', { method: 'DELETE' }),
    },
    map: {
      users: ({ bbox, friends, brand, communityIds }: MapUsersParams, signal?: AbortSignal) =>
        request<MapUsersResult>(
          `/map/users${queryString({
            bbox,
            friends: friends ? 'true' : undefined,
            brand,
            communityIds: communityIds?.length ? communityIds.join(',') : undefined,
          })}`,
          { signal },
        ),
    },
    friends: {
      list: (params?: PageParams) => request<Paginated<UserPublic>>(`/friends${queryString(page(params))}`),
      requests: (direction: 'in' | 'out', params?: PageParams) =>
        request<Paginated<FriendRequestDto>>(`/friends/requests${queryString({ direction, ...page(params) })}`),
      send: (userId: string) => request<FriendRequestResult>('/friends/requests', { method: 'POST', json: { userId } }),
      accept: (requestId: string) =>
        request<void>(`/friends/requests/${encodeURIComponent(requestId)}/accept`, { method: 'POST' }),
      decline: (requestId: string) =>
        request<void>(`/friends/requests/${encodeURIComponent(requestId)}/decline`, { method: 'POST' }),
      cancel: (requestId: string) => request<void>(`/friends/requests/${encodeURIComponent(requestId)}`, { method: 'DELETE' }),
      remove: (userId: string) => request<void>(`/friends/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
    },
    notifications: {
      list: (params?: PageParams) => request<Paginated<NotificationDto>>(`/notifications${queryString(page(params))}`),
      unreadCount: () => request<{ count: number }>('/notifications/unread-count'),
      read: (id: string) => request<void>(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }),
      readAll: () => request<void>('/notifications/read-all', { method: 'POST' }),
    },
    push: {
      vapidPublicKey: () => request<{ key: string | null }>('/push/vapid-public-key'),
      subscribe: (input: PushSubscriptionBody) => request<void>('/push/subscriptions', { method: 'POST', json: input }),
      unsubscribe: (endpoint: string) => request<void>('/push/subscriptions', { method: 'DELETE', json: { endpoint } }),
    },
    uploads: {
      create: (file: Blob, purpose: UploadPurpose) => {
        const form = new FormData();
        // `purpose` goes in the query (current contract); the multipart field is kept for older API builds.
        form.append('purpose', purpose);
        form.append('file', file);
        return request<UploadDto>(`/uploads?purpose=${encodeURIComponent(purpose)}`, { method: 'POST', formData: form });
      },
    },
  };
}

export type Endpoints = ReturnType<typeof createEndpoints>;
