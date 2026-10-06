'use client';

import type { FeedScope } from '@autoc/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Composer } from './composer';
import { FeedList } from './feed-list';

const SCOPE_KEY = 'autoc:feed-scope';
const SCOPES: FeedScope[] = ['all', 'communities', 'friends'];

/** /feed — composer and the feed (All / Communities / Friends). */
export function FeedView() {
  const t = useTranslations('feed');
  const [scope, setScope] = useState<FeedScope>('all');
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(SCOPE_KEY) as FeedScope | null;
      if (saved && SCOPES.includes(saved)) setScope(saved);
    } catch {
      // per-tab convenience only
    }
  }, []);
  const change = (next: FeedScope) => {
    setScope(next);
    try {
      window.sessionStorage.setItem(SCOPE_KEY, next);
    } catch {
      // ignore
    }
  };
  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-4">
      <PageHeader title={t('title')} description={t('description')} className="pb-0" />
      <Composer />
      <SegmentedControl
        label={t('scope.label')}
        value={scope}
        onValueChange={change}
        options={SCOPES.map((s) => ({ value: s, label: t(`scope.${s}`) }))}
      />
      <FeedList params={{ scope }} />
    </div>
  );
}
