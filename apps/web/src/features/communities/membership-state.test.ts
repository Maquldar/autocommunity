import type { CommunityDto } from '@autoc/shared';
import { describe, expect, it } from 'vitest';
import {
  actionFor,
  applyMembershipAction,
  communityButtonState,
  communityPermissions,
  hasAnyAction,
  memberActions,
} from './membership-state';

function community(over: Partial<CommunityDto> = {}): CommunityDto {
  return {
    id: 'c1',
    name: 'Night Drive',
    description: '',
    city: 'Almaty',
    avatarUrl: null,
    isPrivate: false,
    memberCount: 10,
    ownerId: 'owner',
    chatId: null,
    myMembership: null,
    createdAt: '2026-10-05T00:00:00Z',
    ...over,
  };
}

describe('communityButtonState / actionFor', () => {
  it.each([
    [community(), 'join', 'join'],
    [community({ isPrivate: true }), 'request', 'request'],
    [community({ isPrivate: true, myMembership: { role: 'member', status: 'pending' } }), 'pending', 'cancel'],
    [community({ myMembership: { role: 'member', status: 'active' } }), 'member', 'leave'],
    [community({ myMembership: { role: 'moderator', status: 'active' } }), 'member', 'leave'],
    [community({ myMembership: { role: 'owner', status: 'active' } }), 'owner', null],
  ] as const)('%#: → %s / %s', (c, kind, action) => {
    const state = communityButtonState(c);
    expect(state.kind).toBe(kind);
    expect(actionFor(state)).toBe(action);
  });
});

describe('applyMembershipAction', () => {
  it('public join → active member, count +1', () => {
    expect(applyMembershipAction(community(), 'join')).toMatchObject({ myMembership: { role: 'member', status: 'active' }, memberCount: 11 });
  });
  it('private request → pending, count unchanged; the server status wins', () => {
    expect(applyMembershipAction(community({ isPrivate: true }), 'request')).toMatchObject({
      myMembership: { status: 'pending' },
      memberCount: 10,
    });
    expect(applyMembershipAction(community({ isPrivate: true }), 'request', { status: 'active' })).toMatchObject({
      myMembership: { status: 'active' },
      memberCount: 11,
    });
  });
  it('cancel a request → none, count unchanged; leave → none, count −1, chat gone', () => {
    const pending = community({ isPrivate: true, myMembership: { role: 'member', status: 'pending' } });
    expect(applyMembershipAction(pending, 'cancel')).toMatchObject({ myMembership: null, memberCount: 10 });
    const member = community({ chatId: 'chat', myMembership: { role: 'moderator', status: 'active' } });
    expect(applyMembershipAction(member, 'leave')).toMatchObject({ myMembership: null, memberCount: 9, chatId: null });
  });
  it('the owner cannot leave (state unchanged)', () => {
    const owned = community({ myMembership: { role: 'owner', status: 'active' } });
    expect(applyMembershipAction(owned, 'leave')).toBe(owned);
  });
});

describe('communityPermissions', () => {
  it('private communities hide members from non-members and pending users', () => {
    expect(communityPermissions(community({ isPrivate: true })).canSeeMembers).toBe(false);
    expect(communityPermissions(community({ isPrivate: true, myMembership: { role: 'member', status: 'pending' } })).canSeeMembers).toBe(false);
    expect(communityPermissions(community()).canSeeMembers).toBe(true);
  });
  it('moderators edit basics and see requests; only the owner edits city/privacy and deletes', () => {
    const mod = communityPermissions(community({ myMembership: { role: 'moderator', status: 'active' } }));
    expect(mod).toMatchObject({ isModerator: true, canSeeRequests: true, canEditBasics: true, canEditOwnerFields: false, canDelete: false });
    const owner = communityPermissions(community({ myMembership: { role: 'owner', status: 'active' } }));
    expect(owner).toMatchObject({ isOwner: true, canEditOwnerFields: true, canDelete: true });
  });
});

describe('memberActions', () => {
  const target = (userId: string, role: 'owner' | 'moderator' | 'member') => ({ userId, role, status: 'active' as const });
  it('owner: promote members, demote moderators, transfer and remove both', () => {
    const owner = { id: 'o', role: 'owner' as const };
    expect(memberActions(owner, target('m', 'member'))).toEqual({ promote: true, demote: false, transfer: true, remove: true });
    expect(memberActions(owner, target('d', 'moderator'))).toEqual({ promote: false, demote: true, transfer: true, remove: true });
  });
  it('moderator: removes plain members only', () => {
    const mod = { id: 'd', role: 'moderator' as const };
    expect(memberActions(mod, target('m', 'member'))).toEqual({ promote: false, demote: false, transfer: false, remove: true });
    expect(hasAnyAction(memberActions(mod, target('d2', 'moderator')))).toBe(false);
    expect(hasAnyAction(memberActions(mod, target('o', 'owner')))).toBe(false);
  });
  it('nobody acts on themselves, on the owner, or as a plain member', () => {
    expect(hasAnyAction(memberActions({ id: 'o', role: 'owner' }, target('o', 'owner')))).toBe(false);
    expect(hasAnyAction(memberActions({ id: 'x', role: 'member' }, target('m', 'member')))).toBe(false);
    expect(hasAnyAction(memberActions({ id: 'x', role: null }, target('m', 'member')))).toBe(false);
  });
});
