'use client';

import { REPORT_TARGET_TYPES, type AdminReportDto, type ReportStatus, type ReportTargetType } from '@autoc/shared';
import { Check, Inbox, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Switch } from '@/components/ui/switch';
import { adminApi, useAdminMutation, useAdminReports } from './api';
import { NoteDialog } from './note-dialog';
import { FilterSelect, PagedList, TimeCell, ToneBadge, UserCell } from './ui';
import { canRemoveContent, reportTargetHref } from './view-models';

const STATUSES: readonly ReportStatus[] = ['open', 'confirmed', 'dismissed'];
const STATUS_TONE = { open: 'warning', confirmed: 'danger', dismissed: 'neutral' } as const;

/** /admin/reports — the moderation queue (open first by default) with target previews. */
export function ReportsView({ initialStatus = 'open' }: { initialStatus?: ReportStatus }) {
  const t = useTranslations('admin.reports');
  const [status, setStatus] = useState<ReportStatus | undefined>(initialStatus);
  const [targetType, setTargetType] = useState<ReportTargetType | undefined>();
  const query = useAdminReports({ status, targetType });
  const [resolving, setResolving] = useState<{ report: AdminReportDto; decision: 'confirm' | 'dismiss' } | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('title')} description={t('description')} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-xl">
        <FilterSelect label={t('status')} value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: t(`statuses.${s}`) }))} testId="report-status-filter" />
        <FilterSelect label={t('targetType')} value={targetType} onChange={setTargetType} options={REPORT_TARGET_TYPES.map((s) => ({ value: s, label: t(`targets.${s}`) }))} />
      </div>
      <PagedList query={query} columns={4} empty={{ icon: Inbox, title: t('empty'), description: t('emptyHint') }}>
        {(items) => (
          <ul className="flex flex-col gap-3" aria-label={t('title')}>
            {items.map((r) => (
              <li key={r.id}>
                <ReportCard report={r} onResolve={(decision) => setResolving({ report: r, decision })} />
              </li>
            ))}
          </ul>
        )}
      </PagedList>
      <ResolveDialog value={resolving} onClose={() => setResolving(null)} />
    </div>
  );
}

function ReportCard({ report, onResolve }: { report: AdminReportDto; onResolve: (d: 'confirm' | 'dismiss') => void }) {
  const t = useTranslations('admin.reports');
  const href = reportTargetHref(report);
  const p = report.preview;
  return (
    <article className="flex flex-col gap-3 rounded-2xl border bg-card p-4" data-testid="report-card" aria-label={t('cardLabel', { target: t(`targets.${report.targetType}`) })}>
      <div className="flex flex-wrap items-center gap-2">
        <ToneBadge tone={STATUS_TONE[report.status]}>{t(`statuses.${report.status}`)}</ToneBadge>
        <ToneBadge tone="outline">{t(`targets.${report.targetType}`)}</ToneBadge>
        <ToneBadge tone="neutral">{t(`reasons.${report.reason}`)}</ToneBadge>
        <TimeCell iso={report.createdAt} />
      </div>

      <div className="flex gap-3 rounded-xl bg-muted/50 p-3">
        {p.imageUrl && !p.deleted ? (
          // eslint-disable-next-line @next/next/no-img-element -- user upload served by the API
          <img src={p.imageUrl} alt="" className="size-16 shrink-0 rounded-lg object-cover" />
        ) : null}
        <div className="flex min-w-0 flex-col gap-0.5">
          {p.title ? <p className="truncate text-sm font-semibold">{p.title}</p> : null}
          {p.deleted ? (
            <p className="text-sm italic text-muted-foreground">{t('deleted')}</p>
          ) : p.text ? (
            <p className="whitespace-pre-line break-words text-sm" data-testid="report-preview">
              {p.text}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noPreview')}</p>
          )}
          {href ? (
            <Link href={href} className="w-fit rounded text-sm font-medium text-primary underline-offset-4 hover:underline focus-ring">
              {t('openTarget')}
            </Link>
          ) : null}
        </div>
      </div>

      {report.details ? (
        <p className="break-words text-sm">
          <span className="font-medium">{t('details')}: </span>
          {report.details}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t('reporter')}</span>
          <UserCell user={report.reporter} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t('targetUser')}</span>
          <UserCell user={report.targetUser} />
        </div>
      </div>

      {report.status === 'open' ? (
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button variant="secondary" leadingIcon={<X aria-hidden="true" />} onClick={() => onResolve('dismiss')}>
            {t('dismiss')}
          </Button>
          <Button variant="danger" leadingIcon={<Check aria-hidden="true" />} onClick={() => onResolve('confirm')}>
            {t('confirm')}
          </Button>
        </div>
      ) : report.resolutionNote ? (
        <p className="border-t pt-3 text-sm text-muted-foreground">
          {t('resolution')}: {report.resolutionNote}
        </p>
      ) : null}
    </article>
  );
}

function ResolveDialog({ value, onClose }: { value: { report: AdminReportDto; decision: 'confirm' | 'dismiss' } | null; onClose: () => void }) {
  const t = useTranslations('admin.reports');
  const [removeContent, setRemoveContent] = useState(true);
  const switchId = useId();
  const mutation = useAdminMutation((vars: { id: string; decision: 'confirm' | 'dismiss'; note: string; removeContent: boolean }) =>
    adminApi.resolve(vars.id, { decision: vars.decision, note: vars.note, removeContent: vars.removeContent }),
  );
  const confirm = value?.decision === 'confirm';
  const removable = value ? canRemoveContent(value.report) : false;
  return (
    <NoteDialog
      open={value !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setRemoveContent(true);
        }
      }}
      tone={confirm ? 'danger' : 'default'}
      title={confirm ? t('confirmTitle') : t('dismissTitle')}
      description={confirm ? t('confirmDescription') : t('dismissDescription')}
      confirmLabel={confirm ? t('confirm') : t('dismiss')}
      successMessage={confirm ? t('confirmed') : t('dismissed')}
      onConfirm={(note) => mutation.mutateAsync({ id: value!.report.id, decision: value!.decision, note, removeContent: confirm && removable && removeContent })}
    >
      {confirm && removable ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
          <label htmlFor={switchId} className="text-sm font-medium">
            {t('removeContent')}
            <span className="block text-xs font-normal text-muted-foreground">{t(`removeHint.${value!.report.targetType === 'sos' ? 'sos' : 'content'}`)}</span>
          </label>
          <Switch id={switchId} checked={removeContent} onCheckedChange={setRemoveContent} data-testid="remove-content" />
        </div>
      ) : null}
    </NoteDialog>
  );
}
