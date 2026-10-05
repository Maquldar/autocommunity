/**
 * System messages carry a key, not prose (API.md §4 "SOS chat"): `sos.chat_created`,
 * `sos.helper_accepted:<nickname>`, `sos.helper_arrived:<nickname>`, `sos.helper_withdrew:<nickname>`,
 * `sos.closed`, `sos.cancelled`. The client localizes them (`chats.system.*`).
 */

export type SystemMessageKey = 'chatCreated' | 'helperAccepted' | 'helperArrived' | 'helperWithdrew' | 'closed' | 'cancelled';

export type ParsedSystemMessage = { key: SystemMessageKey; nickname: string | null } | { key: 'unknown'; nickname: null };

const KEYS: Record<string, SystemMessageKey> = {
  'sos.chat_created': 'chatCreated',
  'sos.helper_accepted': 'helperAccepted',
  'sos.helper_arrived': 'helperArrived',
  'sos.helper_withdrew': 'helperWithdrew',
  'sos.closed': 'closed',
  'sos.cancelled': 'cancelled',
};

const WITH_NICKNAME = new Set<SystemMessageKey>(['helperAccepted', 'helperArrived', 'helperWithdrew']);

export function parseSystemMessage(text: string | null | undefined): ParsedSystemMessage {
  if (!text) return { key: 'unknown', nickname: null };
  const colon = text.indexOf(':');
  const rawKey = colon === -1 ? text : text.slice(0, colon);
  const key = KEYS[rawKey.trim()];
  if (!key) return { key: 'unknown', nickname: null };
  if (!WITH_NICKNAME.has(key)) return { key, nickname: null };
  const nickname = colon === -1 ? '' : text.slice(colon + 1).trim();
  return { key, nickname: nickname || null };
}
