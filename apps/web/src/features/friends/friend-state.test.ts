import type { Relation } from '@autoc/shared';
import { describe, expect, it } from 'vitest';
import { availableActions, friendButtonState, nextRelation, requestDirectionFor, type FriendAction } from './friend-state';

describe('friend state machine', () => {
  it.each<[Relation, string]>([
    ['self', 'self'],
    ['none', 'add'],
    ['request_out', 'requested'],
    ['request_in', 'respond'],
    ['friend', 'friends'],
  ])('%s → %s button', (relation, kind) => {
    expect(friendButtonState(relation).kind).toBe(kind);
  });

  it.each<[Relation, FriendAction[]]>([
    ['self', []],
    ['none', ['add']],
    ['request_out', ['cancel']],
    ['request_in', ['accept', 'decline']],
    ['friend', ['unfriend']],
  ])('%s offers %j', (relation, actions) => {
    expect(availableActions(relation)).toEqual(actions);
  });

  it.each<[Relation, FriendAction, Relation | null]>([
    ['none', 'add', 'request_out'],
    ['request_out', 'cancel', 'none'],
    ['request_in', 'accept', 'friend'],
    ['request_in', 'decline', 'none'],
    ['request_in', 'add', 'friend'], // reverse request auto-accepts
    ['friend', 'unfriend', 'none'],
    ['none', 'unfriend', null],
    ['friend', 'add', null],
    ['self', 'add', null],
    ['request_out', 'accept', null],
  ])('%s + %s → %s', (relation, action, next) => {
    expect(nextRelation(relation, action)).toBe(next);
  });

  it('knows which request list holds the id', () => {
    expect(requestDirectionFor('cancel')).toBe('out');
    expect(requestDirectionFor('accept')).toBe('in');
    expect(requestDirectionFor('decline')).toBe('in');
    expect(requestDirectionFor('add')).toBeNull();
    expect(requestDirectionFor('unfriend')).toBeNull();
  });
});
