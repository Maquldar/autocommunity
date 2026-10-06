'use client';

import type { MessageDto } from '@autoc/shared';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { parseSystemMessage } from './system-message';
import { dayKey, daysBetween } from './timeline';

/** Localized text of a system message key (`sos.helper_accepted:aidar` → "@aidar is coming to help"). */
export function useSystemMessageText(): (text: string | null) => string {
  const t = useTranslations('chats.system');
  return useCallback(
    (text: string | null) => {
      const parsed = parseSystemMessage(text);
      if (parsed.key === 'unknown') return t('unknown');
      const name = parsed.nickname ? `@${parsed.nickname}` : t('someone');
      return t(parsed.key, { name });
    },
    [t],
  );
}

/** One-line preview of a message (chat list, community chat preview). */
export function useMessagePreview(): (message: MessageDto | null) => string {
  const t = useTranslations('chats.preview');
  const systemText = useSystemMessageText();
  return useCallback(
    (message: MessageDto | null) => {
      if (!message) return t('none');
      if (message.deletedAt) return t('deleted');
      switch (message.type) {
        case 'text':
          return (message.text ?? '').replace(/\s+/g, ' ').trim();
        case 'photo':
          return message.text ? `${t('photo')}: ${message.text.replace(/\s+/g, ' ').trim()}` : t('photo');
        case 'location':
          return t('location');
        case 'voice':
          return t('voice');
        case 'system':
          return systemText(message.text);
        default:
          return message.text ?? '';
      }
    },
    [t, systemText],
  );
}

/** Kind of label for a chat-list timestamp, relative to "now" in the app time zone. */
export type ChatTimeKind = 'time' | 'yesterday' | 'weekday' | 'date' | 'dateYear';

export function chatTimeKind(iso: string, now: Date, timeZone = 'Asia/Almaty'): ChatTimeKind {
  const day = dayKey(iso, timeZone);
  const today = dayKey(now, timeZone);
  const diff = daysBetween(day, today);
  if (diff <= 0) return 'time';
  if (diff === 1) return 'yesterday';
  if (diff < 7) return 'weekday';
  return day.slice(0, 4) === today.slice(0, 4) ? 'date' : 'dateYear';
}

/** Chat list time: 14:05 · Yesterday · Mon · 3 Oct · 03.10.2025. */
export function useChatTime(): (iso: string, now: Date) => string {
  const format = useFormatter();
  const t = useTranslations('chats.day');
  return useCallback(
    (iso: string, now: Date) => {
      const date = new Date(iso);
      switch (chatTimeKind(iso, now)) {
        case 'time':
          return format.dateTime(date, { hour: '2-digit', minute: '2-digit' });
        case 'yesterday':
          return t('yesterday');
        case 'weekday':
          return format.dateTime(date, { weekday: 'short' });
        case 'date':
          return format.dateTime(date, { day: 'numeric', month: 'short' });
        case 'dateYear':
          return format.dateTime(date, { day: '2-digit', month: '2-digit', year: 'numeric' });
      }
    },
    [format, t],
  );
}

/** Day separator label: Today · Yesterday · Friday, 3 October · 3 October 2025. */
export function useDayLabel(): (iso: string, now: Date) => string {
  const format = useFormatter();
  const t = useTranslations('chats.day');
  return useCallback(
    (iso: string, now: Date) => {
      const kind = chatTimeKind(iso, now);
      const date = new Date(iso);
      if (kind === 'time') return t('today');
      if (kind === 'yesterday') return t('yesterday');
      if (kind === 'dateYear') return format.dateTime(date, { day: 'numeric', month: 'long', year: 'numeric' });
      return format.dateTime(date, { weekday: 'long', day: 'numeric', month: 'long' });
    },
    [format, t],
  );
}

export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/** OpenStreetMap link for a location message. */
export function mapsUrl(lat: number, lng: number): string {
  const la = lat.toFixed(6);
  const ln = lng.toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${la}&mlon=${ln}#map=16/${la}/${ln}`;
}
