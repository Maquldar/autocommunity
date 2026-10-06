import { z } from 'zod';
import { idSchema, INVISIBLE_RE, paginationQuerySchema } from './schemas';
import type { UploadDto, UserMini } from './types';

/* ---------- limits (phase 8, API.md §8) ---------- */

export const FEED_LIMITS = {
  textMax: 3000,
  /** Images per post (purpose `post`); a video post carries exactly one `video` upload. */
  mediaMax: 6,
  pollQuestionMin: 3,
  pollQuestionMax: 200,
  pollOptionsMin: 2,
  pollOptionsMax: 6,
  pollOptionMax: 80,
  commentMax: 1000,
  postsPerDay: 20,
  commentsPerHour: 60,
  /** One `post_comment` notification per post per this many seconds. */
  commentNotifyThrottleSec: 600,
  /** One `post_like` notification per post per this many seconds. */
  likeNotifyThrottleSec: 3600,
  /** Text preview carried in notification payloads. */
  previewMax: 120,
} as const;

export const FEED_SCOPES = ['all', 'communities', 'friends'] as const;
export type FeedScope = (typeof FEED_SCOPES)[number];

/* ---------- DTOs ---------- */

export type PollOptionDto = { id: string; text: string; voteCount: number };

export type PollDto = {
  question: string;
  multiple: boolean;
  options: PollOptionDto[];
  /** Option ids the viewer voted for (empty until they vote; votes are final). */
  myVotes: string[];
  /** Distinct users who voted. */
  totalVoters: number;
};

export type PostDto = {
  id: string;
  author: UserMini;
  community: { id: string; name: string } | null;
  text: string;
  media: UploadDto[];
  poll: PollDto | null;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  createdAt: string;
  /** The viewer may delete it (author, or a moderator of its community). */
  canDelete: boolean;
};

export type PostCommentDto = {
  id: string;
  postId: string;
  author: UserMini;
  text: string;
  createdAt: string;
  /** Comment author, post author or a community moderator. */
  canDelete: boolean;
};

export type LikeResult = { likeCount: number; likedByMe: boolean };

/** `post_comment` / `post_like` payloads. */
export type PostNotificationPayload = { postId: string; preview: string; user: UserMini; commentId?: string };

/* ---------- request schemas ---------- */

const multiline = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !INVISIBLE_RE.test(v.replace(/[\t\n\r]/g, '')), 'Contains invalid characters');

const pollOptionSchema = z
  .string()
  .trim()
  .min(1)
  .max(FEED_LIMITS.pollOptionMax)
  .refine((v) => !INVISIBLE_RE.test(v) && !/[\r\n\t]/.test(v), 'Contains invalid characters');

export const pollInputSchema = z.object({
  question: z
    .string()
    .trim()
    .min(FEED_LIMITS.pollQuestionMin)
    .max(FEED_LIMITS.pollQuestionMax)
    .refine((v) => !INVISIBLE_RE.test(v) && !/[\r\n\t]/.test(v), 'Contains invalid characters'),
  options: z
    .array(pollOptionSchema)
    .min(FEED_LIMITS.pollOptionsMin)
    .max(FEED_LIMITS.pollOptionsMax)
    .refine((opts) => new Set(opts.map((o) => o.toLowerCase())).size === opts.length, 'Options must be different'),
  multiple: z.boolean().default(false),
});
export type PollInput = z.output<typeof pollInputSchema>;

export const createPostSchema = z
  .object({
    text: multiline(FEED_LIMITS.textMax).optional(),
    mediaUploadIds: z
      .array(idSchema)
      .max(FEED_LIMITS.mediaMax)
      .refine((ids) => new Set(ids).size === ids.length, 'Duplicate uploads')
      .optional(),
    communityId: idSchema.nullable().optional(),
    poll: pollInputSchema.nullable().optional(),
  })
  .refine((p) => !!p.text || !!p.mediaUploadIds?.length || !!p.poll, {
    message: 'A post needs text, media or a poll',
    path: ['text'],
  });
export type CreatePostInput = z.output<typeof createPostSchema>;

export const feedQuerySchema = paginationQuerySchema.extend({
  scope: z.enum(FEED_SCOPES).default('all'),
  communityId: idSchema.optional(),
  authorId: idSchema.optional(),
});
export type FeedQuery = z.output<typeof feedQuerySchema>;

export const createCommentSchema = z.object({ text: multiline(FEED_LIMITS.commentMax).pipe(z.string().min(1)) });
export type CreateCommentInput = z.output<typeof createCommentSchema>;

export const pollVoteSchema = z.object({
  optionIds: z
    .array(idSchema)
    .min(1)
    .max(FEED_LIMITS.pollOptionsMax)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate options'),
});
export type PollVoteInput = z.output<typeof pollVoteSchema>;

/** Notification preview: collapsed whitespace, at most FEED_LIMITS.previewMax characters. */
export function textPreview(text: string, max: number = FEED_LIMITS.previewMax): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
