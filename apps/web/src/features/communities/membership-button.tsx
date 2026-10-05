'use client';

import type { CommunityDto } from '@autoc/shared';
import { Clock, Crown, LogOut, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import { actionFor, communityButtonState, type MembershipAction } from './membership-state';
import { useMembershipAction } from './queries';

/** Join / Request to join / Request sent (cancel) / Leave; the owner sees why they can't leave. */
export function MembershipButton({ community, className }: { community: CommunityDto; className?: string }) {
  const t = useTranslations('communities');
  const online = useOnlineStatus();
  const errorMessage = useErrorMessage();
  const mutation = useMembershipAction(community.id);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const state = communityButtonState(community);
  const action = actionFor(state);

  const run = async (next: MembershipAction) => {
    try {
      const result = await mutation.mutateAsync(next);
      if (next === 'join' || next === 'request') {
        notify.success(result?.status === 'pending' ? t('toasts.requested') : t('toasts.joined', { name: community.name }));
      } else if (next === 'cancel') notify.success(t('toasts.cancelled'));
      else notify.success(t('toasts.left', { name: community.name }));
    } catch (error) {
      notify.error(errorMessage(error));
      throw error;
    }
  };

  if (state.kind === 'owner') {
    return (
      <div className={className}>
        <p className="inline-flex items-start gap-2 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground" data-testid="owner-note">
          <Crown aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>
            <span className="font-medium text-foreground">{t('actions.owner')}</span> {t('ownerHint')}
          </span>
        </p>
      </div>
    );
  }

  if (state.kind === 'member') {
    return (
      <>
        <Button
          variant="outline"
          className={className}
          leadingIcon={<LogOut aria-hidden="true" className="rtl:rotate-180" />}
          loading={mutation.isPending}
          disabled={!online}
          onClick={() => setConfirmLeave(true)}
        >
          {t('actions.leave')}
        </Button>
        <ConfirmDialog
          open={confirmLeave}
          onOpenChange={setConfirmLeave}
          tone="danger"
          title={t('leaveTitle', { name: community.name })}
          description={community.isPrivate ? t('leaveDescriptionPrivate') : t('leaveDescription')}
          confirmLabel={t('actions.leave')}
          onConfirm={() => run('leave')}
        />
      </>
    );
  }

  if (state.kind === 'pending') {
    return (
      <div className={cn('flex flex-wrap items-center gap-2', className)} data-testid="membership-pending">
        <Badge variant="warning" className="h-9 px-3 text-sm">
          <Clock aria-hidden="true" />
          {t('actions.pending')}
        </Badge>
        <Button variant="ghost" size="sm" loading={mutation.isPending} disabled={!online} onClick={() => void run('cancel').catch(() => undefined)}>
          {t('actions.cancelRequest')}
        </Button>
      </div>
    );
  }

  return (
    <Button
      className={className}
      leadingIcon={<UserPlus aria-hidden="true" />}
      loading={mutation.isPending}
      disabled={!online}
      onClick={() => action && void run(action).catch(() => undefined)}
    >
      {state.kind === 'join' ? t('actions.join') : t('actions.request')}
    </Button>
  );
}
