'use client';

import type { SendMessageInput, UserMini } from '@autoc/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import { useErrorMessage } from '@/hooks/use-error-message';
import { api } from '@/lib/api';
import { notify } from '@/lib/toast';
import { cacheIncomingMessage } from './cache';
import type { PendingMessage } from './timeline';

/**
 * Outgoing messages per chat, kept outside React so they survive navigating away and back while a
 * send is in flight. Failed ones stay (with Retry / Remove) until the user acts.
 */
export function createOutbox() {
  const state = new Map<string, PendingMessage[]>();
  const listeners = new Set<() => void>();
  const EMPTY: PendingMessage[] = [];
  const emit = () => listeners.forEach((l) => l());
  const set = (chatId: string, next: PendingMessage[]) => {
    if (next.length === 0) state.delete(chatId);
    else state.set(chatId, next);
    emit();
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: (chatId: string): PendingMessage[] => state.get(chatId) ?? EMPTY,
    add(message: PendingMessage) {
      set(message.chatId, [...(state.get(message.chatId) ?? []), message]);
    },
    update(chatId: string, clientId: string, patch: Partial<PendingMessage>) {
      set(
        chatId,
        (state.get(chatId) ?? []).map((m) => (m.clientId === clientId ? { ...m, ...patch } : m)),
      );
    },
    remove(chatId: string, clientId: string) {
      const message = state.get(chatId)?.find((m) => m.clientId === clientId);
      if (message?.previewUrl && typeof URL !== 'undefined' && 'revokeObjectURL' in URL) URL.revokeObjectURL(message.previewUrl);
      set(
        chatId,
        (state.get(chatId) ?? []).filter((m) => m.clientId !== clientId),
      );
    },
  };
}

export const outbox = createOutbox();

export function usePendingMessages(chatId: string): PendingMessage[] {
  return useSyncExternalStore(
    outbox.subscribe,
    () => outbox.get(chatId),
    () => outbox.get(chatId),
  );
}

let counter = 0;
export function newClientId(): string {
  counter += 1;
  return `local-${Date.now().toString(36)}-${counter}`;
}

export type Draft =
  | { type: 'text'; text: string }
  | { type: 'photo'; file: Blob; text?: string; width?: number | null; height?: number | null }
  | { type: 'location'; lat: number; lng: number }
  | { type: 'voice'; file: Blob; durationSec: number };

export function draftToPending(chatId: string, draft: Draft, clientId = newClientId(), now = new Date()): PendingMessage {
  const media = draft.type === 'photo' || draft.type === 'voice';
  return {
    clientId,
    chatId,
    type: draft.type,
    text: draft.type === 'text' ? draft.text.trim() : draft.type === 'photo' ? (draft.text?.trim() || null) : null,
    previewUrl: media && typeof URL !== 'undefined' && 'createObjectURL' in URL ? URL.createObjectURL(draft.file) : null,
    file: media ? draft.file : null,
    uploadId: null,
    width: draft.type === 'photo' ? (draft.width ?? null) : null,
    height: draft.type === 'photo' ? (draft.height ?? null) : null,
    durationSec: draft.type === 'voice' ? draft.durationSec : null,
    lat: draft.type === 'location' ? draft.lat : null,
    lng: draft.type === 'location' ? draft.lng : null,
    createdAt: now.toISOString(),
    status: 'sending',
  };
}

function voiceFilename(mime: string): string {
  if (mime.includes('ogg')) return 'voice.ogg';
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'voice.m4a';
  if (mime.includes('mpeg')) return 'voice.mp3';
  return 'voice.webm';
}

/**
 * Optimistic send: the message shows immediately as "sending"; media are uploaded first (purpose
 * `message` / `voice`), then the message is posted. On success the server copy replaces it; on failure
 * it stays as "failed" with Retry (the upload isn't repeated if it already succeeded).
 */
export function useSendMessage(chatId: string, me: UserMini) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();

  const deliver = useCallback(
    async (pending: PendingMessage) => {
      outbox.update(chatId, pending.clientId, { status: 'sending' });
      try {
        let uploadId = pending.uploadId;
        if ((pending.type === 'photo' || pending.type === 'voice') && !uploadId) {
          const file = pending.file!;
          const upload =
            pending.type === 'photo'
              ? await api.uploads.create(file, 'message')
              : await api.uploads.create(file, 'voice', {
                  durationSec: pending.durationSec ?? undefined,
                  filename: voiceFilename(file.type),
                });
          uploadId = upload.id;
          outbox.update(chatId, pending.clientId, { uploadId });
        }
        let input: SendMessageInput;
        switch (pending.type) {
          case 'text':
            input = { type: 'text', text: pending.text ?? '' };
            break;
          case 'photo':
            input = { type: 'photo', uploadId: uploadId!, ...(pending.text ? { text: pending.text } : {}) };
            break;
          case 'voice':
            input = { type: 'voice', uploadId: uploadId! };
            break;
          case 'location':
            input = { type: 'location', lat: pending.lat!, lng: pending.lng! };
            break;
        }
        const message = await api.chats.send(chatId, input);
        cacheIncomingMessage(queryClient, message, me.id);
        outbox.remove(chatId, pending.clientId);
      } catch (error) {
        outbox.update(chatId, pending.clientId, { status: 'failed' });
        notify.error(errorMessage(error), { id: `send-failed-${chatId}` });
      }
    },
    [chatId, me.id, queryClient, errorMessage],
  );

  const send = useCallback(
    (draft: Draft) => {
      const pending = draftToPending(chatId, draft);
      outbox.add(pending);
      void deliver(pending);
    },
    [chatId, deliver],
  );

  const retry = useCallback(
    (clientId: string) => {
      const pending = outbox.get(chatId).find((m) => m.clientId === clientId);
      if (pending) void deliver(pending);
    },
    [chatId, deliver],
  );

  const discard = useCallback((clientId: string) => outbox.remove(chatId, clientId), [chatId]);

  return { send, retry, discard };
}
