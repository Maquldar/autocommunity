'use client';

import type { CreateVoteInput, MyVoteDto, VoteSummaryDto } from '@autoc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

const { request } = apiClient;
const enc = encodeURIComponent;

/** API.md §9.3. */
export const votesApi = {
  summary: (userId: string) => request<VoteSummaryDto>(`/users/${enc(userId)}/votes/summary`),
  vote: (userId: string, body: CreateVoteInput) => request<MyVoteDto>(`/users/${enc(userId)}/votes`, { method: 'POST', json: body }),
};

export const voteKeys = {
  all: ['votes'] as const,
  summary: (userId: string) => ['votes', 'summary', userId] as const,
};

export function useVoteSummary(userId: string, enabled = true) {
  return useQuery({ queryKey: voteKeys.summary(userId), queryFn: () => votesApi.summary(userId), enabled });
}

export function useCastVote(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateVoteInput) => votesApi.vote(userId, body),
    onSuccess: (myVote) => {
      // Show the result right away (counts and "vote again in N days"), then re-read the server's view.
      queryClient.setQueryData<VoteSummaryDto>(voteKeys.summary(userId), (s) =>
        s
          ? {
              ...s,
              up: s.up + (myVote.value === 1 ? 1 : 0),
              down: s.down + (myVote.value === -1 ? 1 : 0),
              byReason: { ...s.byReason, [myVote.reason]: (s.byReason[myVote.reason] ?? 0) + 1 },
              myVote,
              eligibility: 'already_voted',
            }
          : s,
      );
      void queryClient.invalidateQueries({ queryKey: voteKeys.summary(userId) });
      // The vote moves the target's rating.
      void queryClient.invalidateQueries({ queryKey: ['users', userId] });
      void queryClient.invalidateQueries({ queryKey: ['rating', 'user', userId] });
    },
  });
}
