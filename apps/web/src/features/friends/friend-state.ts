import type { Relation } from '@autoc/shared';

/**
 * Friend button state machine, driven by `UserPublic.relation` (API.md §1–2).
 *
 *   none ──add──▶ request_out ──cancel──▶ none
 *   request_in ──accept──▶ friend      request_in ──decline──▶ none
 *   friend ──unfriend──▶ none
 *   (add on request_in is an accept: the API auto-accepts a reverse request)
 */
export type FriendAction = 'add' | 'cancel' | 'accept' | 'decline' | 'unfriend';

export type FriendButtonState =
  | { kind: 'self' }
  | { kind: 'add' }
  | { kind: 'requested' }
  | { kind: 'respond' }
  | { kind: 'friends' };

export function friendButtonState(relation: Relation): FriendButtonState {
  switch (relation) {
    case 'self':
      return { kind: 'self' };
    case 'none':
      return { kind: 'add' };
    case 'request_out':
      return { kind: 'requested' };
    case 'request_in':
      return { kind: 'respond' };
    case 'friend':
      return { kind: 'friends' };
  }
}

/** Actions the UI offers for a relation, in display order. */
export function availableActions(relation: Relation): FriendAction[] {
  switch (relation) {
    case 'none':
      return ['add'];
    case 'request_out':
      return ['cancel'];
    case 'request_in':
      return ['accept', 'decline'];
    case 'friend':
      return ['unfriend'];
    case 'self':
      return [];
  }
}

/** Relation after an action succeeds; used for optimistic updates. Invalid transitions return null. */
export function nextRelation(relation: Relation, action: FriendAction): Relation | null {
  if (!availableActions(relation).includes(action) && !(action === 'add' && relation === 'request_in')) return null;
  switch (action) {
    case 'add':
      return relation === 'request_in' ? 'friend' : 'request_out';
    case 'accept':
      return 'friend';
    case 'cancel':
    case 'decline':
    case 'unfriend':
      return 'none';
  }
}

/** The request id an action needs, and in which direction to look it up. */
export function requestDirectionFor(action: FriendAction): 'in' | 'out' | null {
  if (action === 'cancel') return 'out';
  if (action === 'decline' || action === 'accept') return 'in';
  return null;
}
