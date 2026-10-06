'use client';

import type { AdminUserDetail } from '@autoc/shared';
import { Ban, Flag, MessageSquareWarning, ShieldCheck, Siren, SirenIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { UserAvatar } from '@/components/ui/user-avatar';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { RatingBadge } from '@/components/ui/rating-badge';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/lib/auth/guards';
import { hasErrorCode } from '@/lib/api/errors';
import { adminApi, useAdminMutation, useAdminUser } from './api';
import { NoteDialog } from './note-dialog';
import { Facts, Section, TimeCell, ToneBadge } from './ui';
import { BLOCK_PRESETS, isSosBanned, SOS_BAN_PRESETS, untilFromPreset, USER_STATUS_TONE, userActions, type BlockPreset, type SosBanPreset } from './view-models';
import { FlagList } from './fraud-view';
import { ActionList } from './audit-view';
import { AdminVotesPanel, AdminWalletPanel } from './user-phase9-panels';

type Dialog = 'warn' | 'block' | 'unblock' | 'sosBan' | 'sosUnban' | null;

/** /admin/users/[id] — profile, counts, rating ledger, admin history, fraud flags and the actions. */
export function UserDetailView({ id }: { id: string }) {
  const t = useTranslations('admin.user');
  const query = useAdminUser(id);

  if (query.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-4 pt-2">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }
  if (query.isError) {
    return hasErrorCode(query.error, 'NOT_FOUND') ? (
      <ErrorState title={t('notFound')} className="rounded-2xl border bg-card" />
    ) : (
      <ErrorState onRetry={() => void query.refetch()} retrying={query.isFetching} className="rounded-2xl border bg-card" />
    );
  }
  return <Detail data={query.data} />;
}

function Detail({ data }: { data: AdminUserDetail }) {
  const t = useTranslations('admin.user');
  const tc = useTranslations('admin.common');
  const me = useCurrentUser();
  const { user, counts } = data;
  const actions = userActions(user, me.id);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [blockPreset, setBlockPreset] = useState<BlockPreset>('7d');
  const [banPreset, setBanPreset] = useState<SosBanPreset>('72h');
  const mutation = useAdminMutation((fn: () => Promise<unknown>) => fn());
  const run = (fn: () => Promise<unknown>) => mutation.mutateAsync(fn);
  const close = (open: boolean) => (open ? undefined : setDialog(null));
  const name = user.name || (user.nickname ? `@${user.nickname}` : tc('noName'));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader back="/admin/users" title={t('title')} />

      <div className="flex flex-wrap items-center gap-4 rounded-2xl border bg-card p-4">
        <UserAvatar user={{ ...user, name: name }} size="lg" decorative />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="truncate text-lg font-semibold" data-testid="admin-user-name">
            {name}
          </p>
          {user.nickname ? <p className="truncate text-sm text-muted-foreground">@{user.nickname}</p> : null}
          <div className="flex flex-wrap items-center gap-1.5">
            <ToneBadge tone={USER_STATUS_TONE[user.status]}>
              <span data-testid="admin-user-status">{tc(`userStatus.${user.status}`)}</span>
            </ToneBadge>
            {user.role === 'admin' ? <ToneBadge tone="primary">{tc('admin')}</ToneBadge> : null}
            {isSosBanned(user) ? <ToneBadge tone="warning">{tc('sosBanned')}</ToneBadge> : null}
            <RatingBadge rating={user.rating} size="sm" />
          </div>
        </div>
        <Link href={`/u/${user.id}`} className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-ring rounded">
          {t('publicProfile')}
        </Link>
      </div>

      <Section title={t('actions.title')}>
        {actions.protectedTarget ? (
          <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">{t('actions.protected')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" leadingIcon={<MessageSquareWarning aria-hidden="true" />} disabled={!actions.warn} onClick={() => setDialog('warn')}>
              {t('actions.warn')}
            </Button>
            {actions.unblock ? (
              <Button variant="outline" leadingIcon={<ShieldCheck aria-hidden="true" />} onClick={() => setDialog('unblock')}>
                {t('actions.unblock')}
              </Button>
            ) : (
              <Button variant="danger" leadingIcon={<Ban aria-hidden="true" />} disabled={!actions.block} onClick={() => setDialog('block')}>
                {t('actions.block')}
              </Button>
            )}
            {actions.sosUnban ? (
              <Button variant="outline" leadingIcon={<SirenIcon aria-hidden="true" />} onClick={() => setDialog('sosUnban')}>
                {t('actions.sosUnban')}
              </Button>
            ) : (
              <Button variant="outline" leadingIcon={<Siren aria-hidden="true" />} disabled={!actions.sosBan} onClick={() => setDialog('sosBan')}>
                {t('actions.sosBan')}
              </Button>
            )}
          </div>
        )}
      </Section>

      <Section title={t('profile')}>
        <Facts
          items={[
            { label: t('fields.phone'), value: user.phone ? `${user.phone}${user.phoneVerified ? '' : ` (${t('fields.unverified')})`}` : '—' },
            { label: t('fields.city'), value: user.city ?? '—' },
            { label: t('fields.joined'), value: <TimeCell iso={user.createdAt} relative={false} /> },
            { label: t('fields.lastActive'), value: <TimeCell iso={user.lastActiveAt} /> },
            { label: t('fields.blockedUntil'), value: user.status === 'blocked' ? (user.blockedUntil ? <TimeCell iso={user.blockedUntil} relative={false} /> : t('fields.forever')) : '—' },
            { label: t('fields.sosBannedUntil'), value: isSosBanned(user) ? <TimeCell iso={user.sosBannedUntil} relative={false} /> : '—' },
          ]}
        />
      </Section>

      <Section title={t('counts.title')}>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(['sosCreated', 'helps', 'reportsAgainst', 'reportsFiled', 'warnings'] as const).map((k) => (
            <li key={k} className="flex flex-col gap-0.5 rounded-2xl border bg-card p-3">
              <span className="text-xs text-muted-foreground">{t(`counts.${k}`)}</span>
              <span className="text-xl font-semibold tabular-nums" data-testid={`count-${k}`}>
                {counts[k]}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <AdminWalletPanel userId={user.id} name={name} protectedTarget={actions.protectedTarget} />
      <AdminVotesPanel userId={user.id} protectedTarget={actions.protectedTarget} />

      <Section title={t('ratingEvents')}>
        {data.recentRatingEvents.length ? (
          <ul className="overflow-hidden rounded-2xl border bg-card [&>li+li]:border-t">
            {data.recentRatingEvents.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 truncate">{t(`reasons.${e.reason}`)}</span>
                <span className="flex items-center gap-3">
                  <span className={e.delta < 0 ? 'font-semibold text-danger-soft-foreground tabular-nums' : 'font-semibold text-success-soft-foreground tabular-nums'}>
                    {e.delta > 0 ? `+${e.delta}` : e.delta}
                  </span>
                  <TimeCell iso={e.createdAt} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">{t('noRatingEvents')}</p>
        )}
      </Section>

      <Section title={t('adminActions')}>
        {data.recentAdminActions.length ? (
          <ActionList items={data.recentAdminActions} />
        ) : (
          <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">{t('noAdminActions')}</p>
        )}
      </Section>

      <Section title={t('fraudFlags')}>
        {data.fraudFlags.length ? (
          <FlagList items={data.fraudFlags} showUser={false} />
        ) : (
          <p className="flex items-center gap-2 rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
            <Flag aria-hidden="true" className="size-4" />
            {t('noFraudFlags')}
          </p>
        )}
      </Section>

      <NoteDialog
        open={dialog === 'warn'}
        onOpenChange={close}
        title={t('dialogs.warn.title', { name })}
        description={t('dialogs.warn.description')}
        confirmLabel={t('actions.warn')}
        successMessage={t('dialogs.warn.done')}
        onConfirm={(note) => run(() => adminApi.warn(user.id, note))}
      />
      <NoteDialog
        open={dialog === 'block'}
        onOpenChange={close}
        tone="danger"
        title={t('dialogs.block.title', { name })}
        description={t('dialogs.block.description')}
        confirmLabel={t('actions.block')}
        successMessage={t('dialogs.block.done')}
        onConfirm={(note) => run(() => adminApi.block(user.id, note, untilFromPreset(blockPreset)))}
      >
        <SegmentedControl
          label={t('dialogs.duration')}
          value={blockPreset}
          onValueChange={setBlockPreset}
          options={BLOCK_PRESETS.map((p) => ({ value: p, label: t(`presets.${p}`) }))}
        />
      </NoteDialog>
      <NoteDialog
        open={dialog === 'unblock'}
        onOpenChange={close}
        title={t('dialogs.unblock.title', { name })}
        confirmLabel={t('actions.unblock')}
        successMessage={t('dialogs.unblock.done')}
        onConfirm={(note) => run(() => adminApi.unblock(user.id, note))}
      />
      <NoteDialog
        open={dialog === 'sosBan'}
        onOpenChange={close}
        tone="danger"
        title={t('dialogs.sosBan.title', { name })}
        description={t('dialogs.sosBan.description')}
        confirmLabel={t('actions.sosBan')}
        successMessage={t('dialogs.sosBan.done')}
        onConfirm={(note) => run(() => adminApi.sosBan(user.id, note, untilFromPreset(banPreset)!))}
      >
        <SegmentedControl
          label={t('dialogs.duration')}
          value={banPreset}
          onValueChange={setBanPreset}
          options={SOS_BAN_PRESETS.map((p) => ({ value: p, label: t(`presets.${p}`) }))}
        />
      </NoteDialog>
      <NoteDialog
        open={dialog === 'sosUnban'}
        onOpenChange={close}
        title={t('dialogs.sosUnban.title', { name })}
        confirmLabel={t('actions.sosUnban')}
        successMessage={t('dialogs.sosUnban.done')}
        onConfirm={(note) => run(() => adminApi.sosUnban(user.id, note))}
      />
    </div>
  );
}
