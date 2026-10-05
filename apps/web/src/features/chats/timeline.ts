import type { MessageDto, MessageType, UserMini } from '@autoc/shared';
import { compareMessages } from './cache';

/**
 * The conversation timeline: server history merged with optimistic (not yet confirmed) messages,
 * oldest first, with day separators. Pure, so the ordering and dedupe rules are unit-tested.
 */

export type PendingStatus = 'sending' | 'failed';

/** A message the user sent that the server hasn't confirmed yet (or that failed). */
export type PendingMessage = {
  clientId: string;
  chatId: string;
  type: Exclude<MessageType, 'system'>;
  text: string | null;
  /** Local blob URL for photo/voice previews. */
  previewUrl: string | null;
  /** The file to (re)upload; kept for retries. */
  file: Blob | null;
  /** Set once the upload succeeded, so a retry only re-posts the message. */
  uploadId: string | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  lat: number | null;
  lng: number | null;
  createdAt: string;
  status: PendingStatus;
};

export type TimelineMessage = {
  kind: 'message';
  key: string;
  message: MessageDto;
  /** `sent` for server messages; pending ones are `sending` or `failed`. */
  status: 'sent' | PendingStatus;
  pending: PendingMessage | null;
};

export type TimelineDay = { kind: 'day'; key: string; day: string; date: string };
export type TimelineItem = TimelineMessage | TimelineDay;

/** Calendar day (YYYY-MM-DD) of an instant in the app's time zone. */
export function dayKey(iso: string | number | Date, timeZone = 'Asia/Almaty'): string {
  const date = iso instanceof Date ? iso : new Date(iso);
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Whole days between two calendar day keys (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** What a server echo of a pending message looks like, for matching. */
function fingerprint(m: { type: string; text: string | null; lat: number | null; lng: number | null }): string {
  return `${m.type}|${(m.text ?? '').trim()}|${m.lat ?? ''}|${m.lng ?? ''}`;
}

/** Echoes older than the pending message by more than this (clock skew) are not considered. */
const ECHO_SKEW_MS = 120_000;

/**
 * Pending messages whose server copy is already in the history: a `message:new` echo can arrive
 * before our POST resolves. Each server message matches at most one pending one (oldest first),
 * by sender, type, text/coordinates (and upload for media), and time.
 */
export function matchEchoes(server: readonly MessageDto[], pending: readonly PendingMessage[], myId: string): Set<string> {
  const hidden = new Set<string>();
  const mine = server.filter((m) => m.sender.id === myId && !m.deletedAt);
  const used = new Set<string>();
  const sortedPending = [...pending].filter((p) => p.status === 'sending').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const p of sortedPending) {
    const since = Date.parse(p.createdAt) - ECHO_SKEW_MS;
    const match = mine.find((m) => {
      if (used.has(m.id) || Date.parse(m.createdAt) < since || m.type !== p.type) return false;
      if (p.type === 'photo' || p.type === 'voice') return p.uploadId !== null && m.upload?.id === p.uploadId;
      return fingerprint(m) === fingerprint(p);
    });
    if (match) {
      used.add(match.id);
      hidden.add(p.clientId);
    }
  }
  return hidden;
}

/** A pending message rendered like a server one (sender = me). */
export function pendingAsMessage(p: PendingMessage, me: UserMini): MessageDto {
  return {
    id: p.clientId,
    chatId: p.chatId,
    sender: me,
    type: p.type,
    text: p.text,
    upload:
      p.previewUrl !== null
        ? {
            id: p.uploadId ?? p.clientId,
            url: p.previewUrl,
            thumbUrl: p.type === 'photo' ? p.previewUrl : null,
            mime: p.file?.type ?? '',
            width: p.width,
            height: p.height,
            durationSec: p.durationSec,
            sizeBytes: p.file?.size ?? 0,
          }
        : null,
    lat: p.lat,
    lng: p.lng,
    createdAt: p.createdAt,
    deletedAt: null,
  };
}

/**
 * Server messages (any order, may contain duplicates) + pending ones → timeline, oldest first.
 * Pending messages always sort after the confirmed history (they are newer by definition) and keep
 * their send order; their echoes are hidden. A day separator precedes the first message of each day.
 */
export function buildTimeline(
  server: readonly MessageDto[],
  pending: readonly PendingMessage[],
  me: UserMini,
  timeZone = 'Asia/Almaty',
): TimelineItem[] {
  const byId = new Map<string, MessageDto>();
  for (const m of server) {
    const existing = byId.get(m.id);
    // Keep the deleted version if either copy is deleted.
    if (!existing || (m.deletedAt && !existing.deletedAt)) byId.set(m.id, m);
  }
  const confirmed = [...byId.values()].sort(compareMessages);
  const hidden = matchEchoes(confirmed, pending, me.id);
  const visiblePending = pending
    .filter((p) => !hidden.has(p.clientId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.clientId.localeCompare(b.clientId));

  const rows: TimelineMessage[] = [
    ...confirmed.map((message): TimelineMessage => ({ kind: 'message', key: message.id, message, status: 'sent', pending: null })),
    ...visiblePending.map(
      (p): TimelineMessage => ({ kind: 'message', key: p.clientId, message: pendingAsMessage(p, me), status: p.status, pending: p }),
    ),
  ];

  const items: TimelineItem[] = [];
  let lastDay: string | null = null;
  for (const row of rows) {
    const day = dayKey(row.message.createdAt, timeZone);
    if (day !== lastDay) {
      items.push({ kind: 'day', key: `day-${day}`, day, date: row.message.createdAt });
      lastDay = day;
    }
    items.push(row);
  }
  return items;
}

/**
 * Consecutive messages from the same sender within 5 minutes form a group: only the last one shows the
 * avatar, only the first one shows the sender name (community chats).
 */
export function groupPosition(items: readonly TimelineItem[], index: number): { first: boolean; last: boolean } {
  const item = items[index];
  if (!item || item.kind !== 'message') return { first: true, last: true };
  const same = (other: TimelineItem | undefined) =>
    other?.kind === 'message' &&
    other.message.sender.id === item.message.sender.id &&
    other.message.type !== 'system' &&
    Math.abs(Date.parse(other.message.createdAt) - Date.parse(item.message.createdAt)) < 5 * 60_000;
  return { first: !same(items[index - 1]), last: !same(items[index + 1]) };
}
