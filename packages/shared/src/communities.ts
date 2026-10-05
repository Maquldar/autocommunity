import { z } from 'zod';
import { bodyLatSchema, bodyLngSchema, citySchema, idSchema, INVISIBLE_RE, paginationQuerySchema } from './schemas';
import type { UploadDto, UserMini, UserPublic } from './types';

/* ---------- limits (phase 3) ---------- */

export const COMMUNITY_LIMITS = {
  nameMin: 3,
  nameMax: 60,
  descriptionMax: 1000,
  /** Communities one user may own (non-deleted). */
  ownedPerUser: 10,
  /** Active + pending memberships per user. */
  membershipsPerUser: 50,
} as const;

export const CHAT_LIMITS = {
  textMax: 4000,
  messagesPerMinute: 30,
  /** `chat:typing` is relayed at most once per this many ms per user per chat. */
  typingThrottleMs: 3000,
} as const;

/* ---------- enums ---------- */

export const COMMUNITY_ROLES = ['owner', 'moderator', 'member'] as const;
export type CommunityRole = (typeof COMMUNITY_ROLES)[number];
export const MEMBERSHIP_STATUSES = ['active', 'pending'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];
export const CHAT_TYPES = ['direct', 'community', 'event', 'sos'] as const;
export type ChatType = (typeof CHAT_TYPES)[number];
export const MESSAGE_TYPES = ['text', 'photo', 'location', 'voice', 'system'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

/* ---------- DTOs ---------- */

export type CommunityMembership = { role: CommunityRole; status: MembershipStatus };

export type CommunityDto = {
  id: string;
  name: string;
  description: string;
  city: string | null;
  avatarUrl: string | null;
  isPrivate: boolean;
  memberCount: number;
  ownerId: string;
  /** Only for active members. */
  chatId: string | null;
  myMembership: CommunityMembership | null;
  createdAt: string;
};

/** `joinedAt` is null for pending requests; `requestedAt` is when the row was created. */
export type CommunityMemberDto = {
  user: UserPublic;
  role: CommunityRole;
  status: MembershipStatus;
  joinedAt: string | null;
  requestedAt: string;
};

export type MessageDto = {
  id: string;
  chatId: string;
  sender: UserMini;
  type: MessageType;
  /** null for deleted messages */
  text: string | null;
  upload: UploadDto | null;
  lat: number | null;
  lng: number | null;
  createdAt: string;
  deletedAt: string | null;
};

export type ChatDto = {
  id: string;
  type: ChatType;
  refId: string | null;
  title: string;
  avatarUrl: string | null;
  lastMessage: MessageDto | null;
  unreadCount: number;
  /** direct chats only */
  peer?: UserMini;
};

/* realtime payloads */
export type ChatTypingEvent = { chatId: string; user: UserMini };
export type ChatReadEvent = { chatId: string; userId: string; lastReadAt: string };
export type MessageDeletedEvent = { chatId: string; messageId: string };

/* ---------- request schemas ---------- */

/**
 * Display form of a community name: NFKC (fullwidth/compatibility forms folded, composed accents), any run
 * of whitespace → one space, trimmed, trailing punctuation removed. Confusable letters from other scripts
 * (e.g. Cyrillic "С" vs Latin "C") are NOT folded — out of scope.
 */
export function normalizeCommunityName(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[\p{P}\p{S}]+$/u, '')
    .trim();
}

/** Uniqueness key among live communities. */
export const communityNameKey = (name: string): string => normalizeCommunityName(name).toLowerCase();

export const communityNameSchema = z
  .string()
  .max(COMMUNITY_LIMITS.nameMax * 2)
  // Checked on the raw input: invisible characters and line breaks are rejected, not silently folded.
  .refine((v) => !INVISIBLE_RE.test(v) && !/[\t\n]/.test(v), 'Contains invalid characters')
  .transform(normalizeCommunityName)
  .pipe(
    z
      .string()
      .min(COMMUNITY_LIMITS.nameMin)
      .max(COMMUNITY_LIMITS.nameMax)
      .refine((v) => /[\p{L}\p{N}]/u.test(v), 'Must contain a letter or digit'),
  );

export const communityDescriptionSchema = z
  .string()
  .trim()
  .max(COMMUNITY_LIMITS.descriptionMax)
  .refine((v) => !INVISIBLE_RE.test(v.replace(/[\t\n]/g, '')), 'Contains invalid characters');

export const createCommunitySchema = z.object({
  name: communityNameSchema,
  description: communityDescriptionSchema.default(''),
  city: citySchema.nullable().optional(),
  isPrivate: z.boolean(),
  avatarUploadId: idSchema.nullable().optional(),
});
export type CreateCommunityInput = z.output<typeof createCommunitySchema>;

/** Owner: every field. Moderators: name, description, avatarUploadId only. */
export const updateCommunitySchema = z
  .object({
    name: communityNameSchema,
    description: communityDescriptionSchema,
    city: citySchema.nullable(),
    isPrivate: z.boolean(),
    avatarUploadId: idSchema.nullable(),
  })
  .partial();
export type UpdateCommunityInput = z.output<typeof updateCommunitySchema>;

const boolQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

export const communitiesQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(60).optional(),
  mine: boolQuery.optional(),
  city: citySchema.optional(),
});
export type CommunitiesQuery = z.output<typeof communitiesQuerySchema>;

export const communityMembersQuerySchema = paginationQuerySchema.extend({
  status: z.enum(MEMBERSHIP_STATUSES).default('active'),
});

export const updateMemberRoleSchema = z.object({ role: z.enum(COMMUNITY_ROLES) });

export const sendMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().trim().min(1).max(CHAT_LIMITS.textMax) }),
  z.object({
    type: z.literal('photo'),
    uploadId: idSchema,
    text: z.string().trim().max(CHAT_LIMITS.textMax).optional(),
  }),
  z.object({ type: z.literal('location'), lat: bodyLatSchema, lng: bodyLngSchema }),
  z.object({ type: z.literal('voice'), uploadId: idSchema }),
]);
export type SendMessageInput = z.output<typeof sendMessageSchema>;

export const directChatSchema = z.object({ userId: idSchema });

/** Socket payload of chat:join / chat:leave / chat:typing. */
export const chatRefSchema = z.object({ chatId: idSchema });
