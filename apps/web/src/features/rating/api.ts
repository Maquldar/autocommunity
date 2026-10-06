'use client';

import type { CreateSosReviewInput, Paginated, RatingDto, RatingEventDto, ReviewDto } from '@autoc/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { queryString } from '@/lib/api/endpoints';
import { applySosToCache, sosKeys } from '@/features/sos/cache';
import { sosApi } from '@/features/sos/api';

const { request } = apiClient;
const enc = encodeURIComponent;

export const ratingKeys = {
  mine: ['rating', 'me'] as const,
  user: (id: string) => ['rating', 'user', id] as const,
  events: ['rating', 'events'] as const,
  reviews: (id: string) => ['reviews', id] as const,
};

/** API.md §5. */
export const ratingApi = {
  mine: () => request<RatingDto>('/me/rating'),
  user: (id: string) => request<RatingDto>(`/users/${enc(id)}/rating`),
  events: (cursor?: string | null) => request<Paginated<RatingEventDto>>(`/me/rating/events${queryString({ cursor, limit: 20 })}`),
  reviews: (id: string, cursor?: string | null) => request<Paginated<ReviewDto>>(`/users/${enc(id)}/reviews${queryString({ cursor, limit: 20 })}`),
  review: (sosId: string, input: CreateSosReviewInput) => request<ReviewDto>(`/sos/${enc(sosId)}/reviews`, { method: 'POST', json: input }),
};

/** Own (`self`) or another driver's public breakdown. */
export function useRating(userId: string, self: boolean, enabled = true) {
  return useQuery({
    queryKey: self ? ratingKeys.mine : ratingKeys.user(userId),
    queryFn: () => (self ? ratingApi.mine() : ratingApi.user(userId)),
    enabled,
  });
}

export function useRatingEvents(enabled = true) {
  return useInfiniteQuery({
    queryKey: ratingKeys.events,
    queryFn: ({ pageParam }) => ratingApi.events(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

export function useReviews(userId: string) {
  return useInfiniteQuery({
    queryKey: ratingKeys.reviews(userId),
    queryFn: ({ pageParam }) => ratingApi.reviews(userId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Leaves an SOS review, then refreshes the SOS (canReview/reviewTargets) and the target's rating/reviews. */
export function useCreateReview(sosId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSosReviewInput) => ratingApi.review(sosId, input),
    onSuccess: async (_review, input) => {
      void queryClient.invalidateQueries({ queryKey: ratingKeys.user(input.targetUserId) });
      void queryClient.invalidateQueries({ queryKey: ratingKeys.reviews(input.targetUserId) });
      void queryClient.invalidateQueries({ queryKey: ['users', input.targetUserId] });
      try {
        applySosToCache(queryClient, await sosApi.get(sosId), 'update');
      } catch {
        void queryClient.invalidateQueries({ queryKey: sosKeys.detail(sosId) });
      }
    },
  });
}
