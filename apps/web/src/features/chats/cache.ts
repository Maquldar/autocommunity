import type { ChatDto, MessageDto, Paginated } from '@autoc/shared';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';

/**
 * Query-cache helpers for chats (pure functions over the cached data, unit-tested). The realtime
 * handlers and the conversation view both go through these, so a live `message:new` and the echo of
 * our own POST end up in exactly one place.
 */

export const chatKeys = {
  all: ['chats'] as const,
  list: ['chats', 'list'] as const,
  detail: (id: string) => ['chats', id] as const,
  messages: (id: string) => ['chats', id, 'messages'] as const,
};

export type ChatListData = InfiniteData<Paginated<ChatDto>>;
export type MessagesData = InfiniteData<Paginated<MessageDto>>;

/** Messages and chats are ordered by (createdAt, id); ids are UUID v7, so they sort by time as well. */
export function compareMessages(a: Pick<MessageDto, 'createdAt' | 'id'>, b: Pick<MessageDto, 'createdAt' | 'id'>): number {
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** What a deleted message looks like on the wire (API.md §3: text/upload/lat/lng withheld). */
export function asDeleted(message: MessageDto, deletedAt: string): MessageDto {
  return { ...message, text: null, upload: null, lat: null, lng: null, deletedAt: message.deletedAt ?? deletedAt };
}

/**
 * Adds (or replaces, by id) a message in the cached history. Pages are newest-first, so new messages go
 * into page 0 at their sorted position. Returns the input unchanged when nothing is cached.
 */
export function insertMessage(data: MessagesData | undefined, message: MessageDto): MessagesData | undefined {
  if (!data || data.pages.length === 0) return data;
  let replaced = false;
  const pages = data.pages.map((page) => ({
    ...page,
    items: page.items.map((item) => {
      if (item.id !== message.id) return item;
      replaced = true;
      // A late echo never resurrects a message we already know was deleted.
      return item.deletedAt && !message.deletedAt ? item : message;
    }),
  }));
  if (replaced) return { ...data, pages };
  const [first, ...rest] = pages;
  const items = [...first!.items];
  let index = 0;
  while (index < items.length && compareMessages(items[index]!, message) > 0) index += 1;
  items.splice(index, 0, message);
  return { ...data, pages: [{ ...first!, items }, ...rest] };
}

export function markMessageDeleted(data: MessagesData | undefined, messageId: string, deletedAt: string): MessagesData | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) => (item.id === messageId ? asDeleted(item, deletedAt) : item)),
    })),
  };
}

/** Flattened history, oldest first, without duplicates (pages can overlap after a live insert). */
export function flattenMessages(data: MessagesData | undefined): MessageDto[] {
  if (!data) return [];
  const byId = new Map<string, MessageDto>();
  for (const page of data.pages) for (const item of page.items) if (!byId.has(item.id)) byId.set(item.id, item);
  return [...byId.values()].sort(compareMessages);
}

export type IncomingContext = {
  /** The signed-in user (own messages never count as unread). */
  myId: string | null;
  /** The conversation open and visible right now (its messages are read as they arrive). */
  activeChatId: string | null;
};

/**
 * A new message moves its chat to the top of the list with the new preview, and counts as unread
 * unless it is ours or the chat is open. `found: false` means the chat isn't cached (refetch the list).
 */
export function applyIncomingMessage(
  data: ChatListData | undefined,
  message: MessageDto,
  { myId, activeChatId }: IncomingContext,
): { data: ChatListData | undefined; found: boolean } {
  if (!data) return { data, found: false };
  let chat: ChatDto | undefined;
  const pages = data.pages.map((page) => ({
    ...page,
    items: page.items.filter((item) => {
      if (item.id !== message.chatId) return true;
      chat = item;
      return false;
    }),
  }));
  if (!chat) return { data, found: false };
  const isNewer = !chat.lastMessage || compareMessages(message, chat.lastMessage) >= 0;
  const counts = message.sender.id !== myId && message.chatId !== activeChatId && !message.deletedAt;
  // The same message twice (socket echo after our own POST) must not count twice.
  const duplicate = chat.lastMessage?.id === message.id;
  const updated: ChatDto = {
    ...chat,
    lastMessage: isNewer ? message : chat.lastMessage,
    unreadCount: chat.unreadCount + (counts && !duplicate ? 1 : 0),
  };
  const [first, ...rest] = pages;
  return { data: { ...data, pages: [{ ...first!, items: [updated, ...first!.items] }, ...rest] }, found: true };
}

function mapChats(data: ChatListData | undefined, fn: (chat: ChatDto) => ChatDto): ChatListData | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.map(fn) })) };
}

export function setChatRead(data: ChatListData | undefined, chatId: string): ChatListData | undefined {
  return mapChats(data, (chat) => (chat.id === chatId && chat.unreadCount !== 0 ? { ...chat, unreadCount: 0 } : chat));
}

/** A deleted message stops being the list preview's text, and stops counting as unread. */
export function applyDeletedToList(
  data: ChatListData | undefined,
  chatId: string,
  messageId: string,
  deletedAt: string,
): ChatListData | undefined {
  return mapChats(data, (chat) =>
    chat.id === chatId && chat.lastMessage?.id === messageId ? { ...chat, lastMessage: asDeleted(chat.lastMessage, deletedAt) } : chat,
  );
}

/** Sum of unread counts over the loaded chat list (the nav badge). */
export function unreadTotal(data: ChatListData | undefined): number {
  if (!data) return 0;
  const seen = new Set<string>();
  let total = 0;
  for (const page of data.pages) {
    for (const chat of page.items) {
      if (seen.has(chat.id)) continue;
      seen.add(chat.id);
      total += Math.max(0, chat.unreadCount);
    }
  }
  return total;
}

/* ---------- the conversation currently on screen ---------- */

let activeChatId: string | null = null;

/** Set by the conversation view while it is mounted and the tab is visible. */
export function setActiveChat(id: string | null) {
  activeChatId = id;
}

export function getActiveChat(): string | null {
  return activeChatId;
}

/* ---------- cache wiring used by realtime handlers and mutations ---------- */

export function cacheIncomingMessage(queryClient: QueryClient, message: MessageDto, myId: string | null) {
  queryClient.setQueryData<MessagesData>(chatKeys.messages(message.chatId), (data) => insertMessage(data, message));
  let found = false;
  queryClient.setQueryData<ChatListData>(chatKeys.list, (data) => {
    const result = applyIncomingMessage(data, message, { myId, activeChatId });
    found = result.found;
    return result.data;
  });
  if (!found) void queryClient.invalidateQueries({ queryKey: chatKeys.list });
}

export function cacheDeletedMessage(queryClient: QueryClient, chatId: string, messageId: string) {
  const now = new Date().toISOString();
  queryClient.setQueryData<MessagesData>(chatKeys.messages(chatId), (data) => markMessageDeleted(data, messageId, now));
  queryClient.setQueryData<ChatListData>(chatKeys.list, (data) => applyDeletedToList(data, chatId, messageId, now));
}

export function cacheChatRead(queryClient: QueryClient, chatId: string) {
  queryClient.setQueryData<ChatListData>(chatKeys.list, (data) => setChatRead(data, chatId));
  queryClient.setQueryData<ChatDto>(chatKeys.detail(chatId), (chat) => (chat && chat.unreadCount ? { ...chat, unreadCount: 0 } : chat));
}

/** Chat list and chat headers (not message histories) — after membership changes. */
export function invalidateChatLists(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] === 'chats' && query.queryKey.length <= 2,
  });
}
