import type { MessageDto } from '@autoc/shared';
import { describe, expect, it } from 'vitest';
import { buildTimeline, dayKey, groupPosition, matchEchoes, type PendingMessage, type TimelineMessage } from './timeline';

const me = { id: 'me', nickname: 'me', name: 'Me', avatarUrl: null, rating: 50 };
const peer = { id: 'peer', nickname: 'peer', name: 'Peer', avatarUrl: null, rating: 50 };

function msg(id: string, iso: string, over: Partial<MessageDto> = {}): MessageDto {
  return { id, chatId: 'c1', sender: peer, type: 'text', text: id, upload: null, lat: null, lng: null, createdAt: iso, deletedAt: null, ...over };
}

function pending(clientId: string, iso: string, over: Partial<PendingMessage> = {}): PendingMessage {
  return {
    clientId,
    chatId: 'c1',
    type: 'text',
    text: clientId,
    previewUrl: null,
    file: null,
    uploadId: null,
    width: null,
    height: null,
    durationSec: null,
    lat: null,
    lng: null,
    createdAt: iso,
    status: 'sending',
    ...over,
  };
}

const ids = (items: ReturnType<typeof buildTimeline>) =>
  items.map((item) => (item.kind === 'day' ? `day:${item.day}` : `${item.key}:${item.status}`));

describe('buildTimeline', () => {
  it('orders server messages oldest first, dedupes by id, and adds day separators (Asia/Almaty)', () => {
    const server = [
      msg('m3', '2026-10-05T04:00:00Z'),
      msg('m1', '2026-10-04T10:00:00Z'),
      msg('m2', '2026-10-04T18:30:00Z'), // 23:30 in Almaty (UTC+5): still the 4th
      msg('m3', '2026-10-05T04:00:00Z'),
    ];
    expect(ids(buildTimeline(server, [], me))).toEqual(['day:2026-10-04', 'm1:sent', 'm2:sent', 'day:2026-10-05', 'm3:sent']);
  });

  it('puts pending messages after the confirmed history in send order', () => {
    const items = buildTimeline(
      [msg('m1', '2026-10-05T10:00:00Z')],
      [pending('local-2', '2026-10-05T10:00:02Z'), pending('local-1', '2026-10-05T10:00:01Z', { status: 'failed' })],
      me,
    );
    expect(ids(items)).toEqual(['day:2026-10-05', 'm1:sent', 'local-1:failed', 'local-2:sending']);
    const local = items[3] as TimelineMessage;
    expect(local.message.sender.id).toBe('me');
  });

  it('hides a pending message once its server echo is in the history (echo before POST resolves)', () => {
    const items = buildTimeline(
      [msg('s1', '2026-10-05T10:00:01Z', { sender: me, text: 'hello' })],
      [pending('local-1', '2026-10-05T10:00:00Z', { text: 'hello' })],
      me,
    );
    expect(ids(items)).toEqual(['day:2026-10-05', 's1:sent']);
  });

  it('a deleted copy wins over a live one with the same id', () => {
    const items = buildTimeline(
      [msg('m1', '2026-10-05T10:00:00Z'), msg('m1', '2026-10-05T10:00:00Z', { deletedAt: '2026-10-05T10:01:00Z', text: null })],
      [],
      me,
    );
    expect((items[1] as TimelineMessage).message.deletedAt).not.toBeNull();
  });
});

describe('matchEchoes', () => {
  it('matches each server message to at most one pending message', () => {
    const server = [msg('s1', '2026-10-05T10:00:05Z', { sender: me, text: 'ok' })];
    const hidden = matchEchoes(server, [pending('a', '2026-10-05T10:00:00Z', { text: 'ok' }), pending('b', '2026-10-05T10:00:01Z', { text: 'ok' })], 'me');
    expect([...hidden]).toEqual(['a']);
  });

  it('ignores other senders, failed sends and different content', () => {
    const server = [msg('s1', '2026-10-05T10:00:05Z', { text: 'ok' }), msg('s2', '2026-10-05T10:00:05Z', { sender: me, text: 'other' })];
    expect(matchEchoes(server, [pending('a', '2026-10-05T10:00:00Z', { text: 'ok' })], 'me').size).toBe(0);
    const mine = [msg('s3', '2026-10-05T10:00:05Z', { sender: me, text: 'ok' })];
    expect(matchEchoes(mine, [pending('a', '2026-10-05T10:00:00Z', { text: 'ok', status: 'failed' })], 'me').size).toBe(0);
  });

  it('matches media by upload id and locations by coordinates', () => {
    const upload = { id: 'up1', url: 'u', thumbUrl: null, mime: 'image/webp', width: 1, height: 1, durationSec: null, sizeBytes: 1 };
    const server = [
      msg('s1', '2026-10-05T10:00:05Z', { sender: me, type: 'photo', text: null, upload }),
      msg('s2', '2026-10-05T10:00:06Z', { sender: me, type: 'location', text: null, lat: 43.2, lng: 76.9 }),
    ];
    const hidden = matchEchoes(
      server,
      [
        pending('p', '2026-10-05T10:00:00Z', { type: 'photo', text: null, uploadId: 'up1' }),
        pending('q', '2026-10-05T10:00:00Z', { type: 'photo', text: null, uploadId: null }),
        pending('l', '2026-10-05T10:00:01Z', { type: 'location', text: null, lat: 43.2, lng: 76.9 }),
      ],
      'me',
    );
    expect([...hidden].sort()).toEqual(['l', 'p']);
  });
});

describe('dayKey / groupPosition', () => {
  it('uses the Almaty calendar day', () => {
    expect(dayKey('2026-10-04T18:59:59Z')).toBe('2026-10-04');
    expect(dayKey('2026-10-04T19:00:00Z')).toBe('2026-10-05');
  });

  it('groups consecutive messages from one sender within 5 minutes', () => {
    const items = buildTimeline(
      [
        msg('a', '2026-10-05T10:00:00Z'),
        msg('b', '2026-10-05T10:01:00Z'),
        msg('c', '2026-10-05T10:09:00Z'),
        msg('d', '2026-10-05T10:09:30Z', { sender: me }),
      ],
      [],
      me,
    );
    // index 0 is the day separator
    expect(groupPosition(items, 1)).toEqual({ first: true, last: false });
    expect(groupPosition(items, 2)).toEqual({ first: false, last: true });
    expect(groupPosition(items, 3)).toEqual({ first: true, last: true });
    expect(groupPosition(items, 4)).toEqual({ first: true, last: true });
  });
});
