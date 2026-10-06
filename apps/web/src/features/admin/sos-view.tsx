'use client';

import { SOS_STATUSES, type AdminSosDetail, type SosStatus } from '@autoc/shared';
import { Siren, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { hasErrorCode } from '@/lib/api/errors';
import { adminApi, useAdminMutation, useAdminSos, useAdminSosList } from './api';
import { NoteDialog } from './note-dialog';
import { Facts, FilterSelect, PagedList, Section, TableCard, Td, Th, TimeCell, ToneBadge, UserCell } from './ui';
import { SOS_STATUS_TONE } from './view-models';

/** /admin/sos — every SOS, filterable by status. */
export function SosListView({ initialStatus }: { initialStatus?: SosStatus }) {
  const t = useTranslations('admin.sos');
  const [status, setStatus] = useState<SosStatus | undefined>(initialStatus);
  const query = useAdminSosList({ status });
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('title')} description={t('description')} />
      <div className="max-w-xs">
        <FilterSelect label={t('status')} value={status} onChange={setStatus} options={SOS_STATUSES.map((s) => ({ value: s, label: t(`statuses.${s}`) }))} />
      </div>
      <PagedList query={query} columns={5} empty={{ icon: Siren, title: t('empty') }}>
        {(items) => (
          <TableCard label={t('title')}>
            <thead>
              <tr>
                <Th>{t('columns.sos')}</Th>
                <Th className="hidden md:table-cell">{t('columns.requester')}</Th>
                <Th>{t('columns.status')}</Th>
                <Th className="hidden sm:table-cell">{t('columns.responses')}</Th>
                <Th className="hidden lg:table-cell">{t('columns.created')}</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <Link href={`/admin/sos/${s.id}`} className="flex flex-col rounded font-medium hover:underline focus-ring">
                      {t(`types.${s.type}`)}
                      {s.description ? <span className="line-clamp-1 max-w-64 text-xs font-normal text-muted-foreground">{s.description}</span> : null}
                    </Link>
                  </Td>
                  <Td className="hidden md:table-cell">
                    <UserCell user={s.requester} />
                  </Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      <ToneBadge tone={SOS_STATUS_TONE[s.status]}>{t(`statuses.${s.status}`)}</ToneBadge>
                      {s.isFake ? <ToneBadge tone="danger">{t('fake')}</ToneBadge> : null}
                    </span>
                  </Td>
                  <Td className="hidden tabular-nums sm:table-cell">{s.responsesCount}</Td>
                  <Td className="hidden lg:table-cell">
                    <TimeCell iso={s.createdAt} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableCard>
        )}
      </PagedList>
    </div>
  );
}

/** /admin/sos/[id] — full detail with responses, reports and "mark fake". */
export function SosDetailView({ id }: { id: string }) {
  const t = useTranslations('admin.sos');
  const query = useAdminSos(id);
  if (query.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-4 pt-2">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-40 w-full rounded-2xl" />
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
  return <SosDetail sos={query.data} />;
}

function SosDetail({ sos }: { sos: AdminSosDetail }) {
  const t = useTranslations('admin.sos');
  const [open, setOpen] = useState(false);
  const mutation = useAdminMutation((note: string) => adminApi.markFake(sos.id, note));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back="/admin/sos"
        title={t(`types.${sos.type}`)}
        actions={
          sos.isFake ? null : (
            <Button variant="danger" size="sm" leadingIcon={<TriangleAlert aria-hidden="true" />} onClick={() => setOpen(true)}>
              {t('markFake')}
            </Button>
          )
        }
      />
      <div className="flex flex-wrap gap-1.5">
        <ToneBadge tone={SOS_STATUS_TONE[sos.status]}>
          <span data-testid="sos-status">{t(`statuses.${sos.status}`)}</span>
        </ToneBadge>
        {sos.isFake ? <ToneBadge tone="danger">{t('fake')}</ToneBadge> : null}
      </div>
      <Facts
        items={[
          { label: t('fields.requester'), value: <UserCell user={sos.requester} /> },
          { label: t('fields.description'), value: sos.description || '—' },
          { label: t('fields.created'), value: <TimeCell iso={sos.createdAt} relative={false} /> },
          { label: t('fields.ended'), value: <TimeCell iso={sos.closedAt} relative={false} /> },
          { label: t('fields.cancelReason'), value: sos.cancelReason ?? '—' },
          { label: t('fields.location'), value: `${sos.lat.toFixed(5)}, ${sos.lng.toFixed(5)}` },
          { label: t('fields.radius'), value: t('fields.km', { km: Math.round(sos.radiusM / 100) / 10 }) },
          { label: t('fields.dispatched'), value: sos.dispatchCount },
          {
            label: t('fields.chat'),
            value: sos.chatId ? <span className="font-mono text-xs">{sos.chatId}</span> : '—',
          },
        ]}
      />
      {sos.photos.length ? (
        <Section title={t('photos')}>
          <ul className="flex flex-wrap gap-2">
            {sos.photos.map((p) => (
              <li key={p.id}>
                <a href={p.url} target="_blank" rel="noreferrer" className="block rounded-xl focus-ring">
                  {/* eslint-disable-next-line @next/next/no-img-element -- user upload served by the API */}
                  <img src={p.thumbUrl ?? p.url} alt={t('photoAlt')} className="size-28 rounded-xl object-cover" />
                </a>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title={t('responses')}>
        {sos.responses.length ? (
          <ul className="overflow-hidden rounded-2xl border bg-card [&>li+li]:border-t">
            {sos.responses.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <UserCell user={r.helper} />
                <span className="flex items-center gap-3">
                  <ToneBadge tone="outline">{t(`responseStatuses.${r.status}`)}</ToneBadge>
                  <TimeCell iso={r.createdAt} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">{t('noResponses')}</p>
        )}
      </Section>
      <Section title={t('reports')}>
        {sos.reports.length ? (
          <ul className="overflow-hidden rounded-2xl border bg-card [&>li+li]:border-t">
            {sos.reports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <UserCell user={r.reporter} />
                <span>{r.details ?? '—'}</span>
                <TimeCell iso={r.createdAt} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">{t('noReports')}</p>
        )}
      </Section>
      <NoteDialog
        open={open}
        onOpenChange={setOpen}
        tone="danger"
        title={t('markFakeTitle')}
        description={t('markFakeDescription')}
        confirmLabel={t('markFake')}
        successMessage={t('markedFake')}
        onConfirm={(note) => mutation.mutateAsync(note)}
      />
    </div>
  );
}
