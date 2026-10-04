import type {
  AuthProviders,
  AuthResult,
  Me,
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

/** Every Phase 1 endpoint from API.md §1, typed with the shared DTOs. */
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
