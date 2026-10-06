'use client';

import type { FeedScope, LikeResult, Paginated, PollDto, PollInput, PostCommentDto, PostDto, ReportReason, ReportTargetType } from '@autoc/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { queryString } from '@/lib/api/endpoints';
import { applyVote } from './poll-math';

const { request } = apiClient;
const enc = encodeURIComponent;

export type CreatePostBody = { text?: string; mediaUploadIds?: string[]; communityId?: string | null; poll?: PollInput | null };
export type FeedParams = { scope: FeedScope; communityId?: string | null; authorId?: string | null };

/** API.md §8 feed endpoints (+ POST /reports for the report dialog). */
export const feedApi = {
  feed: (p: FeedParams, cursor?: string | null) =>
    request<Paginated<PostDto>>(`/feed${queryString({ scope: p.scope, communityId: p.communityId, authorId: p.authorId, cursor, limit: 15 })}`),
  get: (id: string) => request<PostDto>(`/posts/${enc(id)}`),
  create: (body: CreatePostBody) => request<PostDto>('/posts', { method: 'POST', json: body }),
  remove: (id: string) => request<void>(`/posts/${enc(id)}`, { method: 'DELETE' }),
  like: (id: string) => request<LikeResult>(`/posts/${enc(id)}/like`, { method: 'POST' }),
  unlike: (id: string) => request<LikeResult>(`/posts/${enc(id)}/like`, { method: 'DELETE' }),
  comments: (id: string, cursor?: string | null) => request<Paginated<PostCommentDto>>(`/posts/${enc(id)}/comments${queryString({ cursor, limit: 30 })}`),
  comment: (id: string, text: string) => request<PostCommentDto>(`/posts/${enc(id)}/comments`, { method: 'POST', json: { text } }),
  removeComment: (id: string) => request<void>(`/comments/${enc(id)}`, { method: 'DELETE' }),
  vote: (id: string, optionIds: string[]) => request<PollDto>(`/posts/${enc(id)}/poll/vote`, { method: 'POST', json: { optionIds } }),
  report: (body: { targetType: ReportTargetType; targetId: string; reason: ReportReason; details?: string }) =>
    request<unknown>('/reports', { method: 'POST', json: body }),
};

export const feedKeys = {
  all: ['feed'] as const,
  lists: ['feed', 'list'] as const,
  list: (p: FeedParams) => ['feed', 'list', p.scope, p.communityId ?? null, p.authorId ?? null] as const,
  post: (id: string) => ['feed', 'post', id] as const,
  comments: (id: string) => ['feed', 'post', id, 'comments'] as const,
};

type FeedData = InfiniteData<Paginated<PostDto>>;

export function useFeed(p: FeedParams, enabled = true) {
  return useInfiniteQuery({
    queryKey: feedKeys.list(p),
    queryFn: ({ pageParam }) => feedApi.feed(p, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

export function usePost(id: string) {
  return useQuery({ queryKey: feedKeys.post(id), queryFn: () => feedApi.get(id) });
}

export function useComments(id: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: feedKeys.comments(id),
    queryFn: ({ pageParam }) => feedApi.comments(id, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

/** Applies `update` to the post wherever it is cached (feed pages and the post detail). */
export function updateCachedPost(queryClient: QueryClient, id: string, update: (post: PostDto) => PostDto) {
  queryClient.setQueriesData<FeedData>({ queryKey: feedKeys.lists }, (data) =>
    data ? { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.map((p) => (p.id === id ? update(p) : p)) })) } : data,
  );
  queryClient.setQueryData<PostDto>(feedKeys.post(id), (post) => (post ? update(post) : post));
}

function removeCachedPost(queryClient: QueryClient, id: string) {
  queryClient.setQueriesData<FeedData>({ queryKey: feedKeys.lists }, (data) =>
    data ? { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.filter((p) => p.id !== id) })) } : data,
  );
}

function snapshot(queryClient: QueryClient, id: string) {
  return {
    lists: queryClient.getQueriesData<FeedData>({ queryKey: feedKeys.lists }),
    post: queryClient.getQueryData<PostDto>(feedKeys.post(id)),
  };
}

function restore(queryClient: QueryClient, id: string, snap: ReturnType<typeof snapshot>) {
  for (const [key, data] of snap.lists) queryClient.setQueryData(key, data);
  queryClient.setQueryData(feedKeys.post(id), snap.post);
}

export function useCreatePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePostBody) => feedApi.create(body),
    onSuccess: (post) => {
      queryClient.setQueryData(feedKeys.post(post.id), post);
      void queryClient.invalidateQueries({ queryKey: feedKeys.lists });
    },
  });
}

export function useDeletePost(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => feedApi.remove(id),
    onSuccess: () => {
      removeCachedPost(queryClient, id);
      queryClient.removeQueries({ queryKey: feedKeys.post(id) });
    },
  });
}

/** Optimistic like toggle; the server's counts win once it answers, the snapshot comes back on error. */
export function useToggleLike(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (like: boolean) => (like ? feedApi.like(id) : feedApi.unlike(id)),
    onMutate: async (like) => {
      await queryClient.cancelQueries({ queryKey: feedKeys.all });
      const snap = snapshot(queryClient, id);
      updateCachedPost(queryClient, id, (p) =>
        p.likedByMe === like ? p : { ...p, likedByMe: like, likeCount: Math.max(0, p.likeCount + (like ? 1 : -1)) },
      );
      return snap;
    },
    onError: (_error, _like, snap) => {
      if (snap) restore(queryClient, id, snap);
    },
    onSuccess: (result) => updateCachedPost(queryClient, id, (p) => ({ ...p, likeCount: result.likeCount, likedByMe: result.likedByMe })),
  });
}

/** Votes are final: optimistic results, then the server's poll. */
export function useVote(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (optionIds: string[]) => feedApi.vote(id, optionIds),
    onMutate: async (optionIds) => {
      await queryClient.cancelQueries({ queryKey: feedKeys.all });
      const snap = snapshot(queryClient, id);
      updateCachedPost(queryClient, id, (p) => (p.poll ? { ...p, poll: applyVote(p.poll, optionIds) } : p));
      return snap;
    },
    onError: (_error, _ids, snap) => {
      if (snap) restore(queryClient, id, snap);
    },
    onSuccess: (poll) => updateCachedPost(queryClient, id, (p) => ({ ...p, poll })),
  });
}

export function useAddComment(postId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => feedApi.comment(postId, text),
    onSuccess: () => {
      updateCachedPost(queryClient, postId, (p) => ({ ...p, commentCount: p.commentCount + 1 }));
      void queryClient.invalidateQueries({ queryKey: feedKeys.comments(postId) });
    },
  });
}

export function useDeleteComment(postId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => feedApi.removeComment(commentId),
    onSuccess: (_void, commentId) => {
      queryClient.setQueryData<InfiniteData<Paginated<PostCommentDto>>>(feedKeys.comments(postId), (data) =>
        data ? { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.filter((c) => c.id !== commentId) })) } : data,
      );
      updateCachedPost(queryClient, postId, (p) => ({ ...p, commentCount: Math.max(0, p.commentCount - 1) }));
    },
  });
}

export function useReport() {
  return useMutation({ mutationFn: feedApi.report });
}
