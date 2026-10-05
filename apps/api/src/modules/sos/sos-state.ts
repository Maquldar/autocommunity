import { SOS_LIMITS, SOS_OPEN_STATUSES, type SosResponseStatus, type SosStatus } from '@autoc/shared';

export type SosAction = 'respond' | 'withdraw' | 'accept' | 'decline' | 'arrived' | 'close' | 'cancel' | 'expire';

export type SosStateInput = {
  sos: SosStatus;
  /** The response the action applies to (null when the actor has none / the action isn't about one). */
  response: SosResponseStatus | null;
  /** Responses in accepted|arrived before the action. */
  activeHelpers: number;
};

export type SosTransition =
  | { ok: true; sos: SosStatus; response: SosResponseStatus | null }
  | { ok: false; code: 'SOS_INVALID_STATE' | 'SOS_HELPER_LIMIT' };

const isOpen = (s: SosStatus) => SOS_OPEN_STATUSES.includes(s);
const invalid: SosTransition = { ok: false, code: 'SOS_INVALID_STATE' };

/**
 * The SOS lifecycle as a pure function (API.md §4 "Lifecycle"). Authorization (who may act) is checked by the
 * caller; this only decides whether the state allows the action and what the new state is.
 */
export function sosTransition(input: SosStateInput, action: SosAction): SosTransition {
  const { sos, response, activeHelpers } = input;
  switch (action) {
    case 'respond':
      // A first offer, or a new offer after withdrawing. Declined helpers can't offer again.
      if ((sos === 'created' || sos === 'accepted') && (response === null || response === 'withdrawn')) {
        return { ok: true, sos, response: 'offered' };
      }
      return invalid;
    case 'withdraw': {
      if (!isOpen(sos) || (response !== 'offered' && response !== 'accepted')) return invalid;
      const remaining = response === 'accepted' ? activeHelpers - 1 : activeHelpers;
      return { ok: true, sos: sos === 'accepted' && remaining <= 0 ? 'created' : sos, response: 'withdrawn' };
    }
    case 'accept':
      if (!isOpen(sos) || response !== 'offered') return invalid;
      if (activeHelpers >= SOS_LIMITS.maxAcceptedHelpers) return { ok: false, code: 'SOS_HELPER_LIMIT' };
      return { ok: true, sos: sos === 'created' ? 'accepted' : sos, response: 'accepted' };
    case 'decline':
      if (!isOpen(sos) || response !== 'offered') return invalid;
      return { ok: true, sos, response: 'declined' };
    case 'arrived':
      if ((sos !== 'accepted' && sos !== 'in_progress') || response !== 'accepted') return invalid;
      return { ok: true, sos: 'in_progress', response: 'arrived' };
    case 'close':
      if (sos !== 'accepted' && sos !== 'in_progress') return invalid;
      return { ok: true, sos: 'closed', response };
    case 'cancel':
      if (!isOpen(sos)) return invalid;
      return { ok: true, sos: 'cancelled', response };
    case 'expire':
      if (sos !== 'created') return invalid;
      return { ok: true, sos: 'expired', response };
  }
}
