'use client';

import { FRAUD_FLAG_KINDS, type FraudFlagDto, type FraudFlagKind } from '@autoc/shared';
import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { useAdminFlags } from './api';
import { FilterSelect, PagedList, TimeCell, ToneBadge, UserCell } from './ui';
import { flagFacts, flagSosId } from './view-models';

const KIND_TONE: Record<FraudFlagKind, 'danger' | 'warning' | 'neutral'> = {
  sos_cancel_streak: 'danger',
  report_burst: 'danger',
  duplicate_sos_photo: 'warning',
  location_teleport: 'warning',
  otp_abuse: 'warning',
  new_account_sos: 'neutral',
  reciprocal_sos: 'warning',
};

/** Flags as cards: kind, who, the key facts, links to the SOS. */
export function FlagList({ items, showUser = true }: { items: FraudFlagDto[]; showUser?: boolean }) {
  const t = useTranslations('admin.fraud');
  const format = useFormatter();
  return (
    <ul className="overflow-hidden rounded-2xl border bg-card [&>li+li]:border-t" aria-label={t('title')}>
      {items.map((flag) => {
        const kind = (FRAUD_FLAG_KINDS as readonly string[]).includes(flag.kind) ? (flag.kind as FraudFlagKind) : null;
        const facts = flagFacts(flag);
        const sosId = flagSosId(flag);
        return (
          <li key={flag.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4" data-testid="fraud-flag">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <ToneBadge tone={kind ? KIND_TONE[kind] : 'neutral'}>{kind ? t(`kinds.${kind}`) : flag.kind}</ToneBadge>
                <TimeCell iso={flag.createdAt} />
              </div>
              <p className="text-sm text-muted-foreground">
                {Object.entries(facts)
                  .map(([k, v]) => `${t(`facts.${k as 'count'}`)}: ${k === 'until' && typeof v === 'string' ? format.dateTime(new Date(v), { dateStyle: 'medium', timeStyle: 'short' }) : v}`)
                  .join(' · ') || t('noFacts')}
              </p>
              {sosId ? (
                <Link href={`/admin/sos/${sosId}`} className="w-fit rounded text-sm font-medium text-primary underline-offset-4 hover:underline focus-ring">
                  {t('openSos')}
                </Link>
              ) : null}
            </div>
            {showUser ? <UserCell user={flag.user} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** /admin/fraud — the antifraud v1 feed, newest first. */
export function FraudView() {
  const t = useTranslations('admin.fraud');
  const [kind, setKind] = useState<FraudFlagKind | undefined>();
  const query = useAdminFlags({ kind });
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('title')} description={t('description')} />
      <div className="max-w-xs">
        <FilterSelect label={t('kind')} value={kind} onChange={setKind} options={FRAUD_FLAG_KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) }))} />
      </div>
      <PagedList query={query} columns={3} empty={{ icon: ShieldAlert, title: t('empty'), description: t('emptyHint') }}>
        {(items) => <FlagList items={items} />}
      </PagedList>
    </div>
  );
}
