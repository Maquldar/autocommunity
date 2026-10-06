import type { SosDto, SosResponseDto, UserPublic } from '@autoc/shared';

export function user(id: string, extra: Partial<UserPublic> = {}): UserPublic {
  return {
    id,
    nickname: id,
    name: `User ${id}`,
    avatarUrl: null,
    city: null,
    bio: null,
    rating: 50,
    createdAt: '2026-01-01T00:00:00Z',
    primaryVehicle: null,
    relation: 'none',
    status: 'active',
    ...extra,
  };
}

export function response(id: string, status: SosResponseDto['status'], extra: Partial<SosResponseDto> = {}): SosResponseDto {
  return { id, helper: user(`h-${id}`), status, distanceM: 1200, helperPhone: null, createdAt: '2026-10-05T10:01:00Z', ...extra };
}

export function sos(extra: Partial<SosDto> = {}): SosDto {
  return {
    id: 's1',
    type: 'flat_tire',
    description: '',
    photos: [],
    lat: 43.25,
    lng: 76.9,
    status: 'created',
    requester: user('req'),
    distanceM: 900,
    radiusM: 5000,
    createdAt: '2026-10-05T10:00:00Z',
    closedAt: null,
    expiresAt: '2026-10-05T12:00:00Z',
    responses: [],
    myRole: 'requester',
    contactPhone: null,
    chatId: null,
    canReview: false,
    reviewTargets: [],
    ...extra,
  };
}
