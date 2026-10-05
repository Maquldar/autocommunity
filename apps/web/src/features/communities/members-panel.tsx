'use client';

import type { CommunityDto, CommunityMemberDto } from '@autoc/shared';
import { Crown, Inbox, MoreHorizontal, ShieldCheck, ShieldMinus, UserMinus, UsersRound } from 'lucide-react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { InfiniteList } from '@/components/ui/infinite-list';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { useCurrentUser } from '@/lib/auth/guards';
import { notify } from '@/lib/toast';
import { UserRow, UserRowSkeleton } from '@/features/friends/user-row';
import { communityPermissions, hasAnyAction, memberActions } from './membership-state';
import { useCommunityMembers, useMemberMutation } from './queries';

const LIST_CLASS = 'overflow-hidden rounded-2xl border bg-card';
const DIVIDED = '[&>li+li]:border-t';

function RoleBadge({ role }: { role: CommunityMemberDto['role'] }) {
  const t = useTranslations('communities.role');
  if (role === 'member') return null;
  return (
    <Badge size="sm" variant="primary">
      {role === 'owner' ? <Crown aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
      {t(role)}
    </Badge>
  );
}

/** Active members, with role badges; managers get a ⋯ menu per row (promote, demote, transfer, remove). */
export function MembersList({ community, compact = false }: { community: CommunityDto; compact?: boolean }) {
  const t = useTranslations('communities');
  const me = useCurrentUser();
  const permissions = communityPermissions(community);
  const query = useCommunityMembers(community.id, 'active', permissions.canSeeMembers);
  return (
    <InfiniteList
      query={query}
      label={t('membersList.label')}
      getKey={(member) => member.user.id}
      className={LIST_CLASS}
      listClassName={DIVIDED}
      skeleton={<UserRowSkeleton />}
      skeletonCount={compact ? 2 : 4}
      hideEnd={compact}
      empty={<EmptyState icon={UsersRound} title={t('membersList.empty')} />}
      renderItem={(member) => {
        const actions = memberActions({ id: me.id, role: permissions.role }, { ...member, userId: member.user.id });
        return (
          <UserRow
            user={member.user}
            meta={member.user.id === me.id ? t('membersList.you') : undefined}
            action={
              <div className="flex items-center gap-1">
                <RoleBadge role={member.role} />
                {hasAnyAction(actions) ? <MemberActionsMenu community={community} member={member} actions={actions} /> : null}
              </div>
            }
          />
        );
      }}
    />
  );
}

type Confirm = 'remove' | 'transfer' | null;

function MemberActionsMenu({
  community,
  member,
  actions,
}: {
  community: CommunityDto;
  member: CommunityMemberDto;
  actions: ReturnType<typeof memberActions>;
}) {
  const t = useTranslations('communities');
  const online = useOnlineStatus();
  const errorMessage = useErrorMessage();
  const mutation = useMemberMutation(community.id);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const name = member.user.name || `@${member.user.nickname}`;

  const setRole = (role: 'moderator' | 'member') =>
    mutation.mutate(
      { kind: 'role', userId: member.user.id, role },
      {
        onSuccess: () => notify.success(role === 'moderator' ? t('toasts.promoted', { name }) : t('toasts.demoted', { name })),
        onError: (error) => notify.error(errorMessage(error)),
      },
    );

  const run = async (kind: 'remove' | 'transfer') => {
    try {
      if (kind === 'remove') await mutation.mutateAsync({ kind: 'remove', userId: member.user.id });
      else await mutation.mutateAsync({ kind: 'role', userId: member.user.id, role: 'owner' });
      notify.success(kind === 'remove' ? t('toasts.removed', { name }) : t('toasts.transferred', { name }));
    } catch (error) {
      notify.error(errorMessage(error));
      throw error;
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton aria-label={t('membersList.actionsFor', { name })} size="sm" variant="ghost" disabled={mutation.isPending}>
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {actions.promote ? (
            <DropdownMenuItem disabled={!online} onSelect={() => setRole('moderator')}>
              <ShieldCheck aria-hidden="true" />
              {t('memberActions.promote')}
            </DropdownMenuItem>
          ) : null}
          {actions.demote ? (
            <DropdownMenuItem disabled={!online} onSelect={() => setRole('member')}>
              <ShieldMinus aria-hidden="true" />
              {t('memberActions.demote')}
            </DropdownMenuItem>
          ) : null}
          {actions.transfer ? (
            <DropdownMenuItem disabled={!online} onSelect={() => setConfirm('transfer')}>
              <Crown aria-hidden="true" />
              {t('memberActions.transfer')}
            </DropdownMenuItem>
          ) : null}
          {actions.remove ? (
            <>
              {actions.promote || actions.demote || actions.transfer ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem destructive disabled={!online} onSelect={() => setConfirm('remove')}>
                <UserMinus aria-hidden="true" />
                {t('memberActions.remove')}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirm === 'remove'}
        onOpenChange={(open) => setConfirm(open ? 'remove' : null)}
        tone="danger"
        title={t('confirm.removeTitle', { name })}
        description={t('confirm.removeDescription')}
        confirmLabel={t('memberActions.remove')}
        onConfirm={() => run('remove')}
      />
      <ConfirmDialog
        open={confirm === 'transfer'}
        onOpenChange={(open) => setConfirm(open ? 'transfer' : null)}
        title={t('confirm.transferTitle', { name })}
        description={t('confirm.transferDescription')}
        confirmLabel={t('memberActions.transfer')}
        onConfirm={() => run('transfer')}
      />
    </>
  );
}

/** Pending join requests (moderators): approve or reject inline. */
export function RequestsList({ community }: { community: CommunityDto }) {
  const t = useTranslations('communities');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const query = useCommunityMembers(community.id, 'pending', communityPermissions(community).canSeeRequests);
  return (
    <InfiniteList
      query={query}
      label={t('requests.label')}
      getKey={(member) => member.user.id}
      className={LIST_CLASS}
      listClassName={DIVIDED}
      skeleton={<UserRowSkeleton />}
      skeletonCount={2}
      empty={<EmptyState icon={Inbox} title={t('requests.empty.title')} description={t('requests.empty.description')} />}
      renderItem={(member) => (
        <UserRow
          user={member.user}
          meta={t('requests.requestedAgo', { time: format.relativeTime(new Date(member.requestedAt), now) })}
          action={<RequestActions community={community} member={member} />}
        />
      )}
    />
  );
}

function RequestActions({ community, member }: { community: CommunityDto; member: CommunityMemberDto }) {
  const t = useTranslations('communities');
  const online = useOnlineStatus();
  const errorMessage = useErrorMessage();
  const mutation = useMemberMutation(community.id);
  const name = member.user.name || `@${member.user.nickname}`;
  const pending = mutation.isPending ? mutation.variables?.kind : undefined;
  const act = (kind: 'approve' | 'reject') =>
    mutation.mutate(
      { kind, userId: member.user.id },
      {
        onSuccess: () => notify.success(kind === 'approve' ? t('toasts.approved', { name }) : t('toasts.rejected')),
        onError: (error) => notify.error(errorMessage(error)),
      },
    );
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" loading={pending === 'approve'} disabled={!online || mutation.isPending} onClick={() => act('approve')}>
        {t('requests.approve')}
      </Button>
      <Button size="sm" variant="secondary" loading={pending === 'reject'} disabled={!online || mutation.isPending} onClick={() => act('reject')}>
        {t('requests.reject')}
      </Button>
    </div>
  );
}
