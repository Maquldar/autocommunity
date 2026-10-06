'use client';

import type { AdminVisitDto } from '@autoc/shared';
import { Camera, Check, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { adminApi, useAdminMutation, useAdminVisits } from './api';
import { NoteDialog } from './note-dialog';
import { PagedList, TimeCell, UserCell } from './ui';

/** /admin/visits — order-photo visits waiting for review; approval lets the user write a review. */
export function VisitsView() {
  const t = useTranslations('admin.visits');
  const query = useAdminVisits();
  const [acting, setActing] = useState<{ visit: AdminVisitDto; action: 'approve' | 'reject' } | null>(null);
  const mutation = useAdminMutation((vars: { id: string; action: 'approve' | 'reject'; note: string }) => adminApi.setVisitStatus(vars.id, vars.action, vars.note));
  const approve = acting?.action === 'approve';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('title')} description={t('description')} />
      <PagedList query={query} columns={3} empty={{ icon: Camera, title: t('empty'), description: t('emptyHint') }}>
        {(items) => (
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-label={t('title')}>
            {items.map((v) => (
              <li key={v.id}>
                <article className="flex h-full flex-col gap-3 rounded-2xl border bg-card p-4" aria-label={v.service.name}>
                  {v.photo ? (
                    <a href={v.photo.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl bg-muted focus-ring">
                      {/* eslint-disable-next-line @next/next/no-img-element -- user upload served by the API */}
                      <img src={v.photo.url} alt={t('photoAlt', { name: v.service.name })} className="aspect-[4/3] w-full object-contain" />
                    </a>
                  ) : (
                    <div className="flex aspect-[4/3] items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground">{t('noPhoto')}</div>
                  )}
                  <div className="flex flex-col gap-0.5">
                    <Link href={`/services/${v.service.id}`} className="w-fit rounded font-semibold hover:underline focus-ring">
                      {v.service.name}
                    </Link>
                    <span className="text-sm text-muted-foreground">{v.service.address}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <UserCell user={v.user} />
                    <TimeCell iso={v.createdAt} />
                  </div>
                  <div className="mt-auto flex flex-wrap justify-end gap-2 border-t pt-3">
                    <Button variant="secondary" leadingIcon={<X aria-hidden="true" />} onClick={() => setActing({ visit: v, action: 'reject' })}>
                      {t('reject')}
                    </Button>
                    <Button leadingIcon={<Check aria-hidden="true" />} onClick={() => setActing({ visit: v, action: 'approve' })}>
                      {t('approve')}
                    </Button>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </PagedList>
      <NoteDialog
        open={acting !== null}
        onOpenChange={(open) => (open ? undefined : setActing(null))}
        tone={approve ? 'default' : 'danger'}
        title={t(approve ? 'approveTitle' : 'rejectTitle')}
        description={t(approve ? 'approveDescription' : 'rejectDescription')}
        confirmLabel={t(approve ? 'approve' : 'reject')}
        successMessage={t(approve ? 'approved' : 'rejected')}
        onConfirm={(note) => mutation.mutateAsync({ id: acting!.visit.id, action: acting!.action, note })}
      />
    </div>
  );
}
