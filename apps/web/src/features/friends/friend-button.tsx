'use client';

import { ChevronDown, Clock, UserCheck, UserMinus, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { cn } from '@/lib/cn';
import { friendButtonState, type FriendAction } from './friend-state';
import { useFriendAction, type FriendTarget } from './queries';

export type FriendButtonProps = {
  user: FriendTarget;
  /** Known request id (request lists, notifications); otherwise it is looked up when needed. */
  requestId?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Stretch the buttons (map card, phones). */
  fullWidth?: boolean;
  className?: string;
};

/**
 * One control for every friendship state (`relation`): Add → Cancel request → Accept/Decline →
 * Friends ✓ (menu with Remove). Used on /u/[id], the map card, search results and request lists.
 */
export function FriendButton({ user, requestId, size = 'md', fullWidth = false, className }: FriendButtonProps) {
  const t = useTranslations('friends');
  const online = useOnlineStatus();
  const mutation = useFriendAction();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const state = friendButtonState(user.relation);
  const pendingAction = mutation.isPending ? mutation.variables?.action : undefined;

  const run = (action: FriendAction) => mutation.mutate({ user, action, requestId });

  if (state.kind === 'self') return null;

  if (state.kind === 'add') {
    return (
      <Button
        size={size}
        fullWidth={fullWidth}
        className={className}
        leadingIcon={<UserPlus aria-hidden="true" />}
        loading={pendingAction === 'add'}
        disabled={!online}
        onClick={() => run('add')}
      >
        {t('actions.add')}
      </Button>
    );
  }

  if (state.kind === 'requested') {
    return (
      <Button
        variant="outline"
        size={size}
        fullWidth={fullWidth}
        className={className}
        leadingIcon={<Clock aria-hidden="true" />}
        loading={pendingAction === 'cancel'}
        disabled={!online}
        onClick={() => run('cancel')}
      >
        {t('actions.cancel')}
      </Button>
    );
  }

  if (state.kind === 'respond') {
    return (
      <div className={cn('flex flex-wrap gap-2', fullWidth && 'w-full [&>*]:flex-1', className)}>
        <Button size={size} loading={pendingAction === 'accept'} disabled={!online || mutation.isPending} onClick={() => run('accept')}>
          {t('actions.accept')}
        </Button>
        <Button
          variant="secondary"
          size={size}
          loading={pendingAction === 'decline'}
          disabled={!online || mutation.isPending}
          onClick={() => run('decline')}
        >
          {t('actions.decline')}
        </Button>
      </div>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size={size}
            fullWidth={fullWidth}
            className={className}
            leadingIcon={<UserCheck aria-hidden="true" />}
            trailingIcon={<ChevronDown aria-hidden="true" />}
            loading={pendingAction === 'unfriend'}
          >
            {t('actions.friends')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem destructive disabled={!online} onSelect={() => setConfirmOpen(true)}>
            <UserMinus aria-hidden="true" />
            {t('actions.unfriend')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="danger"
        title={t('unfriendTitle', { name: user.name })}
        description={t('unfriendDescription')}
        confirmLabel={t('actions.unfriend')}
        onConfirm={() => mutation.mutateAsync({ user, action: 'unfriend', requestId })}
      />
    </>
  );
}
