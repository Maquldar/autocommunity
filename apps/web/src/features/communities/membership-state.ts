import type { CommunityDto, CommunityMemberDto, CommunityRole, MembershipStatus } from '@autoc/shared';

/**
 * Community membership button, driven by `isPrivate` + `myMembership` (API.md §3):
 *
 *   public:  join ──join──▶ member ──leave──▶ join
 *   private: request ──request──▶ pending ──cancel──▶ request
 *            pending ──(moderator approves)──▶ member
 *   owner: can't leave (transfer ownership or delete the community first)
 */
export type CommunityButtonState =
  | { kind: 'join' }
  | { kind: 'request' }
  | { kind: 'pending' }
  | { kind: 'member'; role: Exclude<CommunityRole, 'owner'> }
  | { kind: 'owner' };

export type MembershipAction = 'join' | 'request' | 'cancel' | 'leave';

export function communityButtonState(community: Pick<CommunityDto, 'isPrivate' | 'myMembership'>): CommunityButtonState {
  const membership = community.myMembership;
  if (!membership) return community.isPrivate ? { kind: 'request' } : { kind: 'join' };
  if (membership.status === 'pending') return { kind: 'pending' };
  if (membership.role === 'owner') return { kind: 'owner' };
  return { kind: 'member', role: membership.role };
}

/** The action the main button performs in each state (`null`: no action, e.g. the owner). */
export function actionFor(state: CommunityButtonState): MembershipAction | null {
  switch (state.kind) {
    case 'join':
      return 'join';
    case 'request':
      return 'request';
    case 'pending':
      return 'cancel';
    case 'member':
      return 'leave';
    case 'owner':
      return null;
  }
}

/**
 * The community after an action (optimistic, or with the server's `{ status }` for joins).
 * `chatId` is only known after a refetch, so it stays null until then.
 */
export function applyMembershipAction(
  community: CommunityDto,
  action: MembershipAction,
  result?: { status: MembershipStatus },
): CommunityDto {
  const wasActive = community.myMembership?.status === 'active';
  if (action === 'join' || action === 'request') {
    const status: MembershipStatus = result?.status ?? (community.isPrivate ? 'pending' : 'active');
    if (community.myMembership) return community;
    return {
      ...community,
      myMembership: { role: 'member', status },
      memberCount: community.memberCount + (status === 'active' ? 1 : 0),
    };
  }
  // cancel / leave
  if (community.myMembership?.role === 'owner' && wasActive) return community;
  return {
    ...community,
    myMembership: null,
    chatId: null,
    memberCount: Math.max(0, community.memberCount - (wasActive ? 1 : 0)),
  };
}

/** What the viewer may see and do in a community. */
export function communityPermissions(community: Pick<CommunityDto, 'isPrivate' | 'myMembership'>) {
  const role = community.myMembership?.status === 'active' ? community.myMembership.role : null;
  const isOwner = role === 'owner';
  const isModerator = role === 'owner' || role === 'moderator';
  return {
    role,
    isMember: role !== null,
    isOwner,
    isModerator,
    /** Private communities hide members and chat from non-members. */
    canSeeMembers: !community.isPrivate || role !== null,
    canSeeRequests: isModerator,
    /** Moderators edit name, description and avatar; city and privacy are the owner's. */
    canEditBasics: isModerator,
    canEditOwnerFields: isOwner,
    canDelete: isOwner,
  };
}

export type MemberActions = { promote: boolean; demote: boolean; transfer: boolean; remove: boolean };

/**
 * Actions the viewer can take on a member row (API.md §3): only the owner changes roles and transfers
 * ownership; moderators remove plain members; the owner also removes moderators. Nobody acts on
 * themselves or on the owner.
 */
export function memberActions(
  viewer: { id: string; role: CommunityRole | null },
  target: Pick<CommunityMemberDto, 'role' | 'status'> & { userId: string },
): MemberActions {
  const none = { promote: false, demote: false, transfer: false, remove: false };
  if (target.status !== 'active' || target.userId === viewer.id || target.role === 'owner') return none;
  if (viewer.role === 'owner') {
    return { promote: target.role === 'member', demote: target.role === 'moderator', transfer: true, remove: true };
  }
  if (viewer.role === 'moderator') return { ...none, remove: target.role === 'member' };
  return none;
}

export function hasAnyAction(actions: MemberActions): boolean {
  return actions.promote || actions.demote || actions.transfer || actions.remove;
}
