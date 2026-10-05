'use client';

import type { CommunityDto, CommunityRole, MembershipStatus, Paginated, UpdateCommunityInput } from '@autoc/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { CreateCommunityBody } from '@/lib/api/endpoints';
import { invalidateChatLists } from '@/features/chats/cache';
import { communityKeys, type CommunityListFilters } from './keys';
import { applyMembershipAction, type MembershipAction } from './membership-state';

export { communityKeys } from './keys';

const pageOptions = {
  initialPageParam: null as string | null,
  getNextPageParam: (last: Paginated<unknown>) => last.nextCursor,
};

/** Discover list: everything visible, ordered by memberCount desc, then name (server-side). */
export function useCommunities(filters: CommunityListFilters) {
  return useInfiniteQuery({
    queryKey: communityKeys.list(filters),
    queryFn: ({ pageParam, signal }) =>
      api.communities.list({ q: filters.q || undefined, city: filters.city, cursor: pageParam }, signal),
    ...pageOptions,
  });
}

/** The viewer's active and pending communities (max 50 by the membership limit, so one page). */
export function useMyCommunities(enabled = true) {
  return useQuery({
    queryKey: communityKeys.mine,
    queryFn: ({ signal }) => api.communities.list({ mine: true, limit: 50 }, signal),
    select: (page) => page.items,
    enabled,
  });
}

export function useCommunity(id: string, enabled = true) {
  return useQuery({ queryKey: communityKeys.detail(id), queryFn: () => api.communities.get(id), enabled: enabled && id !== '' });
}

export function useCommunityMembers(id: string, status: MembershipStatus, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: communityKeys.members(id, status),
    queryFn: ({ pageParam }) => api.communities.members(id, status, { cursor: pageParam }),
    enabled,
    ...pageOptions,
  });
}

export function invalidateCommunities(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: communityKeys.all });
}

export function useCreateCommunity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCommunityBody) => api.communities.create(input),
    onSuccess: (community) => {
      queryClient.setQueryData(communityKeys.detail(community.id), community);
      void invalidateCommunities(queryClient);
      void invalidateChatLists(queryClient);
    },
  });
}

export function useUpdateCommunity(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCommunityInput) => api.communities.update(id, input),
    onSuccess: (community) => {
      queryClient.setQueryData(communityKeys.detail(id), community);
      void invalidateCommunities(queryClient);
      void invalidateChatLists(queryClient);
    },
  });
}

export function useDeleteCommunity(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.communities.remove(id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: communityKeys.detail(id) });
      void invalidateCommunities(queryClient);
      void invalidateChatLists(queryClient);
    },
  });
}

/** Join / request / cancel / leave with an optimistic header update. */
export function useMembershipAction(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (action: MembershipAction) => {
      if (action === 'join' || action === 'request') return api.communities.join(id);
      await api.communities.leave(id);
      return undefined;
    },
    onMutate: async (action) => {
      await queryClient.cancelQueries({ queryKey: communityKeys.detail(id), exact: true });
      const previous = queryClient.getQueryData<CommunityDto>(communityKeys.detail(id));
      if (previous) queryClient.setQueryData(communityKeys.detail(id), applyMembershipAction(previous, action));
      return { previous };
    },
    onError: (_error, _action, context) => {
      if (context?.previous) queryClient.setQueryData(communityKeys.detail(id), context.previous);
    },
    onSuccess: (result, action, context) => {
      if (context?.previous && result) {
        queryClient.setQueryData(communityKeys.detail(id), applyMembershipAction(context.previous, action, result));
      }
    },
    onSettled: () => {
      void invalidateCommunities(queryClient);
      void invalidateChatLists(queryClient);
    },
  });
}

export type MemberMutation =
  | { kind: 'approve' | 'reject' | 'remove'; userId: string }
  | { kind: 'role'; userId: string; role: CommunityRole };

/** Moderator actions on requests and members; refreshes the lists and the header afterwards. */
export function useMemberMutation(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: MemberMutation) => {
      switch (input.kind) {
        case 'approve':
          return api.communities.approve(id, input.userId);
        case 'reject':
          return api.communities.reject(id, input.userId);
        case 'remove':
          return api.communities.removeMember(id, input.userId);
        case 'role':
          return api.communities.setRole(id, input.userId, input.role);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: communityKeys.detail(id) }),
  });
}
