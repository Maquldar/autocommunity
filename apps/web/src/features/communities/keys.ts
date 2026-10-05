import type { MembershipStatus } from '@autoc/shared';

export type CommunityListFilters = { q: string; city: string | null };

export const communityKeys = {
  all: ['communities'] as const,
  list: (filters: CommunityListFilters) => ['communities', 'list', filters] as const,
  mine: ['communities', 'mine'] as const,
  detail: (id: string) => ['communities', 'detail', id] as const,
  members: (id: string, status: MembershipStatus) => ['communities', 'detail', id, 'members', status] as const,
};
