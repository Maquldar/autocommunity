'use client';

import { SERVICE_STATUSES, WEEKDAYS, type AdminServiceDto, type ServiceStatus } from '@autoc/shared';
import { Check, QrCode, Wrench, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { adminApi, useAdminMutation, useAdminServices } from './api';
import { MapPreview } from './map-preview';
import { NoteDialog } from './note-dialog';
import { QrDialog } from './qr-dialog';
import { FilterSelect, PagedList, TimeCell, ToneBadge, UserCell } from './ui';

const STATUS_TONE = { pending: 'warning', verified: 'success', rejected: 'neutral' } as const;

/** /admin/services — pending submissions first: map preview, details, verify / reject; printable QR for verified ones. */
export function ServicesAdminView({ initialStatus = 'pending' }: { initialStatus?: ServiceStatus }) {
  const t = useTranslations('admin.services');
  const [status, setStatus] = useState<ServiceStatus | undefined>(initialStatus);
  const query = useAdminServices({ status });
  const [acting, setActing] = useState<{ service: AdminServiceDto; action: 'verify' | 'reject' } | null>(null);
  const [qrFor, setQrFor] = useState<AdminServiceDto | null>(null);
  const mutation = useAdminMutation((vars: { id: string; action: 'verify' | 'reject'; note: string }) => adminApi.setServiceStatus(vars.id, vars.action, vars.note));
  const verify = acting?.action === 'verify';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('title')} description={t('description')} />
      <div className="max-w-xs">
        <FilterSelect label={t('status')} value={status} onChange={setStatus} options={SERVICE_STATUSES.map((s) => ({ value: s, label: t(`statuses.${s}`) }))} />
      </div>
      <PagedList query={query} columns={3} empty={{ icon: Wrench, title: t('empty'), description: t('emptyHint') }}>
        {(items) => (
          <ul className="flex flex-col gap-4" aria-label={t('title')}>
            {items.map((s) => (
              <li key={s.id}>
                <ServiceCard service={s} onAct={(action) => setActing({ service: s, action })} onQr={() => setQrFor(s)} />
              </li>
            ))}
          </ul>
        )}
      </PagedList>
      <NoteDialog
        open={acting !== null}
        onOpenChange={(open) => (open ? undefined : setActing(null))}
        tone={verify ? 'default' : 'danger'}
        title={t(verify ? 'verifyTitle' : 'rejectTitle', { name: acting?.service.name ?? '' })}
        description={t(verify ? 'verifyDescription' : 'rejectDescription')}
        confirmLabel={t(verify ? 'verify' : 'reject')}
        successMessage={t(verify ? 'verified' : 'rejected')}
        onConfirm={(note) => mutation.mutateAsync({ id: acting!.service.id, action: acting!.action, note })}
      />
      <QrDialog service={qrFor} onClose={() => setQrFor(null)} />
    </div>
  );
}

function ServiceCard({ service, onAct, onQr }: { service: AdminServiceDto; onAct: (a: 'verify' | 'reject') => void; onQr: () => void }) {
  const t = useTranslations('admin.services');
  const tCat = useTranslations('services.categories');
  const tDay = useTranslations('admin.services.days');
  return (
    <article className="grid gap-4 rounded-2xl border bg-card p-4 md:grid-cols-[minmax(0,1fr)_18rem]" data-testid="admin-service" aria-label={service.name}>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold leading-tight">{service.name}</h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <ToneBadge tone={STATUS_TONE[service.status]}>{t(`statuses.${service.status}`)}</ToneBadge>
            <ToneBadge tone="outline">{tCat(service.category)}</ToneBadge>
            <TimeCell iso={service.createdAt} />
          </div>
        </div>
        <p className="text-sm">{service.address}</p>
        {service.phone ? <p className="text-sm tabular-nums">{service.phone}</p> : null}
        {service.description ? <p className="whitespace-pre-line break-words text-sm text-muted-foreground">{service.description}</p> : null}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {WEEKDAYS.map((d) => (
            <div key={d} className="contents">
              <dt className="text-muted-foreground">{tDay(d)}</dt>
              <dd className="tabular-nums">{service.hours?.[d] ?? t('closed')}</dd>
            </div>
          ))}
        </dl>
        {service.photos.length ? (
          <ul className="flex flex-wrap gap-2" aria-label={t('photos')}>
            {service.photos.map((p) => (
              <li key={p.id}>
                <a href={p.url} target="_blank" rel="noreferrer" className="block rounded-lg focus-ring">
                  {/* eslint-disable-next-line @next/next/no-img-element -- user upload served by the API */}
                  <img src={p.thumbUrl ?? p.url} alt={t('photoAlt', { name: service.name })} className="size-20 rounded-lg object-cover" />
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t('submittedBy')}</span>
          <UserCell user={service.submittedBy} />
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <MapPreview lat={service.lat} lng={service.lng} label={service.name} />
        <div className="flex flex-wrap justify-end gap-2">
          {service.status !== 'rejected' ? (
            <Button variant="secondary" leadingIcon={<X aria-hidden="true" />} onClick={() => onAct('reject')}>
              {t('reject')}
            </Button>
          ) : null}
          {service.status !== 'verified' ? (
            <Button leadingIcon={<Check aria-hidden="true" />} onClick={() => onAct('verify')}>
              {t('verify')}
            </Button>
          ) : (
            <Button variant="outline" leadingIcon={<QrCode aria-hidden="true" />} onClick={onQr}>
              {t('printQr')}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
