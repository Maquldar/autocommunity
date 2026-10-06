'use client';

import { VIOLATION_STATUSES, type AdminViolationDto, type ViolationStatus } from '@autoc/shared';
import { Check, Gavel, ShieldAlert, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { MediaGrid } from '@/features/feed/media-grid';
import { VIOLATION_STATUS_TONE } from '@/features/violations/view-model';
import { adminApi, useAdminMutation, useAdminViolations } from './api';
import { NoteDialog } from './note-dialog';
import { FilterSelect, PagedList, TimeCell, ToneBadge, UserCell } from './ui';
import { violationActions } from './view-models';

type Decision = { violation: AdminViolationDto; action: 'approve' | 'reject' | 'uphold' | 'remove' };

/** /admin/violations — the moderation queue (pending first, oldest first) with evidence and disputes. */
export function ViolationsView({ initialStatus = 'pending' }: { initialStatus?: ViolationStatus }) {
  const t = useTranslations('admin.violations');
  const tv = useTranslations('violations');
  const [status, setStatus] = useState<ViolationStatus | undefined>(initialStatus);
  const query = useAdminViolations({ status });
  const [decision, setDecision] = useState<Decision | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('title')} description={t('description')} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-xl">
        <FilterSelect
          label={t('status')}
          value={status}
          onChange={setStatus}
          options={VIOLATION_STATUSES.map((s) => ({ value: s, label: tv(`statuses.${s}`) }))}
          testId="violation-status-filter"
        />
      </div>
      <PagedList query={query} columns={4} empty={{ icon: ShieldAlert, title: t('empty'), description: t('emptyHint') }}>
        {(items) => (
          <ul className="flex flex-col gap-3" aria-label={t('title')}>
            {items.map((v) => (
              <li key={v.id}>
                <ViolationCard violation={v} onDecide={(action) => setDecision({ violation: v, action })} />
              </li>
            ))}
          </ul>
        )}
      </PagedList>
      <DecisionDialog value={decision} onClose={() => setDecision(null)} />
    </div>
  );
}

function ViolationCard({ violation: v, onDecide }: { violation: AdminViolationDto; onDecide: (action: Decision['action']) => void }) {
  const t = useTranslations('admin.violations');
  const tv = useTranslations('violations');
  const format = useFormatter();
  const actions = violationActions(v);
  return (
    <article className="flex flex-col gap-3 rounded-2xl border bg-card p-4" data-testid="admin-violation" data-status={v.status} aria-label={tv(`categories.${v.category}`)}>
      <div className="flex flex-wrap items-center gap-2">
        <ToneBadge tone={VIOLATION_STATUS_TONE[v.status]}>{tv(`statuses.${v.status}`)}</ToneBadge>
        <ToneBadge tone="neutral">{tv(`categories.${v.category}`)}</ToneBadge>
        <ToneBadge tone="outline">
          {tv(`codeTypes.${v.codeType}`)}
          {v.article ? ` · ${v.article}` : ''}
        </ToneBadge>
        {v.penaltyApplied ? <ToneBadge tone="danger">{t('penaltyApplied')}</ToneBadge> : null}
        <TimeCell iso={v.createdAt} />
      </div>
      <p className="text-sm">
        {v.vehicle.id ? (
          <Link href={`/vehicles/${v.vehicle.id}`} className="rounded font-semibold text-primary underline-offset-4 hover:underline focus-ring">
            {v.vehicle.brand} {v.vehicle.model}, {v.vehicle.year}
          </Link>
        ) : (
          <span className="font-semibold">
            {v.vehicle.brand} {v.vehicle.model}, {v.vehicle.year}
          </span>
        )}
        <span className="text-muted-foreground"> · {t('occurred', { date: format.dateTime(new Date(v.occurredAt), { dateStyle: 'medium' }) })}</span>
      </p>
      <p className="whitespace-pre-line break-words text-[0.9375rem]" data-testid="admin-violation-description">
        {v.description}
      </p>
      <MediaGrid media={v.photos} label={t('evidence')} />
      {v.dispute ? (
        <div className="flex flex-col gap-1 rounded-xl bg-primary-soft/60 p-3 text-sm">
          <p className="font-medium">{t('dispute')}</p>
          <p className="whitespace-pre-line break-words">{v.dispute.text}</p>
          <TimeCell iso={v.dispute.createdAt} />
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t('owner')}</span>
          <UserCell user={v.owner} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t('submitter')}</span>
          <UserCell
            user={v.submitter}
            sub={
              v.submitterRejectedCount > 0 ? (
                <span className="text-xs font-medium text-warning" data-testid="submitter-rejected">
                  {t('rejectedCount', { count: v.submitterRejectedCount })}
                </span>
              ) : null
            }
          />
        </div>
      </div>
      {v.decisionNote ? (
        <p className="border-t pt-3 text-sm text-muted-foreground">
          {t('decisionNote')}: {v.decisionNote}
        </p>
      ) : null}
      {actions.approve || actions.resolve ? (
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          {actions.reject ? (
            <Button variant="secondary" leadingIcon={<X aria-hidden="true" />} onClick={() => onDecide('reject')}>
              {t('reject')}
            </Button>
          ) : null}
          {actions.approve ? (
            <Button variant="danger" leadingIcon={<Check aria-hidden="true" />} onClick={() => onDecide('approve')} data-testid="admin-violation-approve">
              {t('approve')}
            </Button>
          ) : null}
          {actions.resolve ? (
            <>
              <Button variant="secondary" leadingIcon={<Trash2 aria-hidden="true" />} onClick={() => onDecide('remove')}>
                {t('remove')}
              </Button>
              <Button variant="danger" leadingIcon={<Gavel aria-hidden="true" />} onClick={() => onDecide('uphold')}>
                {t('uphold')}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function DecisionDialog({ value, onClose }: { value: Decision | null; onClose: () => void }) {
  const t = useTranslations('admin.violations');
  const mutation = useAdminMutation(({ id, action, note }: { id: string; action: Decision['action']; note: string }) =>
    action === 'approve' || action === 'reject' ? adminApi.decideViolation(id, action, note) : adminApi.resolveDispute(id, action, note),
  );
  const action = value?.action ?? 'approve';
  return (
    <NoteDialog
      open={value !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      tone={action === 'approve' || action === 'uphold' ? 'danger' : 'default'}
      title={t(`dialogs.${action}.title`)}
      description={t(`dialogs.${action}.description`)}
      confirmLabel={t(action)}
      successMessage={t(`dialogs.${action}.done`)}
      onConfirm={(note) => mutation.mutateAsync({ id: value!.violation.id, action, note })}
    />
  );
}
