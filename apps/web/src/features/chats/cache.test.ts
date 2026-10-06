import type { ChatDto, MessageDto, Paginated } from '@autoc/shared';
import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  applyDeletedToList,
  applyIncomingMessage,
  cacheChatRead,
  cacheIncomingMessage,
  chatKeys,
  flattenMessages,
  insertMessage,
  markMessageDeleted,
  setActiveChat,
  setChatRead,
  unreadTotal,
  type ChatListData,
  type MessagesData,
} from './cache';

const user = (id: string) => ({ id, nickname: id, name: id.toUpperCase(), avatarUrl: null, rating: 50, isPremium: false });

function msg(id: string, at: string, over: Partial<MessageDto> = {}): MessageDto {
  return {
    id,
    chatId: 'c1',
    sender: user('peer'),
    type: 'text',
    text: `text ${id}`,
    upload: null,
    lat: null,
    lng: null,
    createdAt: `2026-10-05T${at}:00.000Z`,
    deletedAt: null,
    ...over,
  };
}

function chat(id: string, unreadCount = 0, lastMessage: MessageDto | null = null): ChatDto {
  return { id, type: 'direct', refId: null, title: id, avatarUrl: null, lastMessage, unreadCount };
}

const pages = <T,>(...lists: T[][]): InfiniteData<Paginated<T>> => ({
  pages: lists.map((items, i) => ({ items, nextCursor: i < lists.length - 1 ? `p${i + 1}` : null })),
  pageParams: lists.map((_, i) => (i === 0 ? null : `p${i}`)),
});

describe('insertMessage', () => {
  it('adds a new message at the top of page 0 (pages are newest first)', () => {
    const data = pages([msg('m2', '10:02'), msg('m1', '10:01')]);
    const next = insertMessage(data, msg('m3', '10:03'))!;
    expect(next.pages[0]!.items.map((m) => m.id)).toEqual(['m3', 'm2', 'm1']);
  });

  it('keeps the sorted position for a slightly older message', () => {
    const data = pages([msg('m3', '10:03'), msg('m1', '10:01')]);
    const next = insertMessage(data, msg('m2', '10:02'))!;
    expect(next.pages[0]!.items.map((m) => m.id)).toEqual(['m3', 'm2', 'm1']);
  });

  it('dedupes by id: the socket echo of our POST replaces, never duplicates', () => {
    const data = pages([msg('m2', '10:02'), msg('m1', '10:01')]);
    const once = insertMessage(data, msg('m3', '10:03'));
    const twice = insertMessage(once, msg('m3', '10:03', { text: 'edited copy' }))!;
    expect(twice.pages[0]!.items.filter((m) => m.id === 'm3')).toHaveLength(1);
    expect(twice.pages[0]!.items[0]!.text).toBe('edited copy');
  });

  it('never resurrects a deleted message from a late echo', () => {
    const deleted = msg('m1', '10:01', { deletedAt: '2026-10-05T10:05:00Z', text: null });
    const next = insertMessage(pages([deleted]), msg('m1', '10:01'))!;
    expect(next.pages[0]!.items[0]!.deletedAt).not.toBeNull();
  });

  it('leaves an uncached history alone', () => {
    expect(insertMessage(undefined, msg('m1', '10:01'))).toBeUndefined();
  });
});

describe('markMessageDeleted / flattenMessages', () => {
  it('nulls content and sets deletedAt', () => {
    const data = pages([msg('m2', '10:02', { lat: 1, lng: 2, type: 'location', text: null })]);
    const item = markMessageDeleted(data, 'm2', '2026-10-05T11:00:00Z')!.pages[0]!.items[0]!;
    expect(item).toMatchObject({ deletedAt: '2026-10-05T11:00:00Z', text: null, upload: null, lat: null, lng: null });
  });

  it('flattens pages oldest first without duplicates', () => {
    const data = pages([msg('m4', '10:04'), msg('m3', '10:03')], [msg('m3', '10:03'), msg('m2', '10:02')]);
    expect(flattenMessages(data).map((m) => m.id)).toEqual(['m2', 'm3', 'm4']);
  });
});

describe('applyIncomingMessage', () => {
  const list = (): ChatListData => pages([chat('a', 0, msg('x', '09:00')), chat('c1', 2, msg('m1', '09:30'))]);

  it('moves the chat to the top with the new preview and counts it unread', () => {
    const { data, found } = applyIncomingMessage(list(), msg('m2', '10:00'), { myId: 'me', activeChatId: null });
    expect(found).toBe(true);
    expect(data!.pages[0]!.items.map((c) => c.id)).toEqual(['c1', 'a']);
    expect(data!.pages[0]!.items[0]).toMatchObject({ unreadCount: 3, lastMessage: { id: 'm2' } });
  });

  it('own messages and the open chat do not count as unread', () => {
    const own = applyIncomingMessage(list(), msg('m2', '10:00', { sender: user('me') }), { myId: 'me', activeChatId: null });
    expect(own.data!.pages[0]!.items[0]!.unreadCount).toBe(2);
    const open = applyIncomingMessage(list(), msg('m3', '10:00'), { myId: 'me', activeChatId: 'c1' });
    expect(open.data!.pages[0]!.items[0]!.unreadCount).toBe(2);
  });

  it('the same message twice counts once', () => {
    const first = applyIncomingMessage(list(), msg('m2', '10:00'), { myId: 'me', activeChatId: null });
    const second = applyIncomingMessage(first.data, msg('m2', '10:00'), { myId: 'me', activeChatId: null });
    expect(second.data!.pages[0]!.items[0]!.unreadCount).toBe(3);
  });

  it('reports chats that are not cached (the caller refetches)', () => {
    expect(applyIncomingMessage(list(), msg('m2', '10:00', { chatId: 'new' }), { myId: 'me', activeChatId: null }).found).toBe(false);
  });
});

describe('unread total and read state', () => {
  it('sums unread counts once per chat across pages', () => {
    const data = pages([chat('a', 2), chat('b', 0)], [chat('b', 0), chat('c', 5)]);
    expect(unreadTotal(data)).toBe(7);
    expect(unreadTotal(undefined)).toBe(0);
  });

  it('setChatRead zeroes one chat', () => {
    const data = setChatRead(pages([chat('a', 2), chat('b', 4)]), 'b');
    expect(unreadTotal(data)).toBe(2);
  });

  it('a deleted last message updates the preview', () => {
    const data = applyDeletedToList(pages([chat('c1', 1, msg('m1', '10:00'))]), 'c1', 'm1', '2026-10-05T10:01:00Z');
    expect(data!.pages[0]!.items[0]!.lastMessage).toMatchObject({ text: null, deletedAt: '2026-10-05T10:01:00Z' });
  });

  it('live updates through the query cache: badge goes up, then read clears it', () => {
    const qc = new QueryClient();
    qc.setQueryData<ChatListData>(chatKeys.list, pages([chat('c1', 0, msg('m1', '09:00'))]));
    qc.setQueryData<MessagesData>(chatKeys.messages('c1'), pages([msg('m1', '09:00')]));
    setActiveChat(null);
    cacheIncomingMessage(qc, msg('m2', '10:00'), 'me');
    expect(unreadTotal(qc.getQueryData(chatKeys.list))).toBe(1);
    expect(flattenMessages(qc.getQueryData(chatKeys.messages('c1'))).map((m) => m.id)).toEqual(['m1', 'm2']);
    cacheChatRead(qc, 'c1');
    expect(unreadTotal(qc.getQueryData(chatKeys.list))).toBe(0);
    setActiveChat('c1');
    cacheIncomingMessage(qc, msg('m3', '10:01'), 'me');
    expect(unreadTotal(qc.getQueryData(chatKeys.list))).toBe(0);
    setActiveChat(null);
  });
});
