import { SOS_LIMITS, SOS_OPEN_STATUSES, type SosDto, type SosResponseDto, type SosStatus } from '@autoc/shared';

/**
 * Pure state derivation for the SOS screens (unit-tested). Components only render what these return, so
 * "which actions are visible for which status/response" lives in one place and matches API.md §4.
 */

export function isSosOpen(status: SosStatus): boolean {
  return SOS_OPEN_STATUSES.includes(status);
}

/** Responses that count towards the 3 accepted helpers. */
export function isActiveHelper(response: Pick<SosResponseDto, 'status'>): boolean {
  return response.status === 'accepted' || response.status === 'arrived';
}

/* ---------- status timeline ---------- */

export type TimelineKey = 'created' | 'accepted' | 'in_progress' | 'closed' | 'cancelled' | 'expired';
export type TimelineStep = { key: TimelineKey; state: 'done' | 'current' | 'upcoming' };

/**
 * created → accepted → in_progress → closed. A cancelled/expired SOS replaces the last step with its
 * terminal state and keeps only the steps it actually reached (inferred from the responses).
 */
export function timelineSteps(sos: Pick<SosDto, 'status' | 'responses'>): TimelineStep[] {
  const { status, responses } = sos;
  const reachedAccepted = responses.some((r) => isActiveHelper(r)) || status === 'accepted' || status === 'in_progress';
  const reachedArrived = responses.some((r) => r.status === 'arrived') || status === 'in_progress';

  switch (status) {
    case 'created':
      return [
        { key: 'created', state: 'current' },
        { key: 'accepted', state: 'upcoming' },
        { key: 'in_progress', state: 'upcoming' },
        { key: 'closed', state: 'upcoming' },
      ];
    case 'accepted':
      return [
        { key: 'created', state: 'done' },
        { key: 'accepted', state: 'current' },
        { key: 'in_progress', state: 'upcoming' },
        { key: 'closed', state: 'upcoming' },
      ];
    case 'in_progress':
      return [
        { key: 'created', state: 'done' },
        { key: 'accepted', state: 'done' },
        { key: 'in_progress', state: 'current' },
        { key: 'closed', state: 'upcoming' },
      ];
    case 'closed':
      return [
        { key: 'created', state: 'done' },
        { key: 'accepted', state: 'done' },
        { key: 'in_progress', state: 'done' },
        { key: 'closed', state: 'current' },
      ];
    case 'cancelled':
    case 'expired': {
      const steps: TimelineStep[] = [{ key: 'created', state: 'done' }];
      if (reachedAccepted) steps.push({ key: 'accepted', state: 'done' });
      if (reachedArrived) steps.push({ key: 'in_progress', state: 'done' });
      steps.push({ key: status, state: 'current' });
      return steps;
    }
  }
}

/* ---------- requester ---------- */

export type ResponseActions = {
  canAccept: boolean;
  canDecline: boolean;
  /** Tap-to-call: only filled by the API for accepted/arrived helpers of an open SOS. */
  phone: string | null;
  /** Grouped below the live offers, dimmed. */
  inactive: boolean;
};

export type RequesterView = {
  open: boolean;
  /** Nobody accepted yet: show the radius and the expiry countdown. */
  searching: boolean;
  acceptedCount: number;
  canAcceptMore: boolean;
  canCancel: boolean;
  canClose: boolean;
  /** "Helper arrived": the requester confirms on behalf of every accepted helper. */
  canMarkArrived: boolean;
  canShare: boolean;
  canOpenChat: boolean;
  /** Offered/accepted/arrived first (accepted on top), then withdrawn/declined. */
  liveResponses: SosResponseDto[];
  pastResponses: SosResponseDto[];
  responseActions: (response: SosResponseDto) => ResponseActions;
};

const RESPONSE_ORDER: Record<SosResponseDto['status'], number> = { arrived: 0, accepted: 1, offered: 2, withdrawn: 3, declined: 4 };

export function requesterView(sos: Pick<SosDto, 'status' | 'responses' | 'chatId'>): RequesterView {
  const open = isSosOpen(sos.status);
  const acceptedCount = sos.responses.filter(isActiveHelper).length;
  const canAcceptMore = open && acceptedCount < SOS_LIMITS.maxAcceptedHelpers;
  const sorted = [...sos.responses].sort(
    (a, b) => RESPONSE_ORDER[a.status] - RESPONSE_ORDER[b.status] || a.createdAt.localeCompare(b.createdAt),
  );
  const awaitingArrival = sos.responses.some((r) => r.status === 'accepted');

  return {
    open,
    searching: sos.status === 'created',
    acceptedCount,
    canAcceptMore,
    canCancel: open,
    canClose: sos.status === 'accepted' || sos.status === 'in_progress',
    canMarkArrived: (sos.status === 'accepted' || sos.status === 'in_progress') && awaitingArrival,
    canShare: open,
    canOpenChat: sos.chatId !== null,
    liveResponses: sorted.filter((r) => r.status === 'offered' || isActiveHelper(r)),
    pastResponses: sorted.filter((r) => r.status === 'withdrawn' || r.status === 'declined'),
    responseActions: (response) => ({
      canAccept: canAcceptMore && response.status === 'offered',
      canDecline: open && response.status === 'offered',
      phone: open && isActiveHelper(response) ? response.helperPhone : null,
      inactive: response.status === 'withdrawn' || response.status === 'declined',
    }),
  };
}

/* ---------- helper / viewer ---------- */

export type HelperState =
  /** No (live) response and the SOS still takes offers. */
  | 'can_offer'
  | 'offered'
  | 'accepted'
  | 'arrived'
  | 'declined'
  /** in_progress without a response of ours: help is already there, offers are closed. */
  | 'unavailable'
  | 'ended';

export type HelperView = {
  state: HelperState;
  open: boolean;
  response: SosResponseDto | null;
  canRespond: boolean;
  canWithdraw: boolean;
  canMarkArrived: boolean;
  /** Call the requester: only when the API exposes the number (sharePhone, or we are accepted). */
  callPhone: string | null;
  canNavigate: boolean;
  /** Message: the SOS group chat once accepted, otherwise a direct chat with the requester. */
  message: { kind: 'sos_chat'; chatId: string } | { kind: 'direct'; userId: string } | null;
};

export function helperView(sos: Pick<SosDto, 'status' | 'responses' | 'contactPhone' | 'chatId' | 'requester'>): HelperView {
  const open = isSosOpen(sos.status);
  // Non-requesters only receive their own response.
  const response = sos.responses[0] ?? null;
  const live = response && response.status !== 'withdrawn' ? response : null;
  const takesOffers = sos.status === 'created' || sos.status === 'accepted';

  let state: HelperState;
  if (!open) state = 'ended';
  else if (!live) state = takesOffers ? 'can_offer' : 'unavailable';
  else if (live.status === 'offered') state = 'offered';
  else if (live.status === 'accepted') state = 'accepted';
  else if (live.status === 'arrived') state = 'arrived';
  else state = 'declined';

  const engaged = state === 'accepted' || state === 'arrived';
  const message: HelperView['message'] =
    engaged && sos.chatId
      ? { kind: 'sos_chat', chatId: sos.chatId }
      : open && state !== 'declined'
        ? { kind: 'direct', userId: sos.requester.id }
        : null;

  return {
    state,
    open,
    response,
    canRespond: state === 'can_offer',
    canWithdraw: state === 'offered' || state === 'accepted',
    canMarkArrived: state === 'accepted',
    callPhone: open && state !== 'declined' ? sos.contactPhone : null,
    canNavigate: open && state !== 'declined' && state !== 'unavailable',
    message,
  };
}
