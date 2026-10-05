'use client';

import { SERVICE_CATEGORIES, type ServiceCategory } from '@autoc/shared';
import { List, Map as MapIcon, Plus } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { CategoryChips } from './category-chips';
import { ServicesList } from './services-list';

// MapLibre touches `window` on import, so the map only loads in the browser (and only when shown).
const ServicesMap = dynamic(() => import('./services-map').then((m) => m.ServicesMap), {
  ssr: false,
  loading: () => <Skeleton className="h-[60dvh] min-h-80 w-full rounded-2xl lg:h-[36rem]" />,
});

type View = 'list' | 'map';

const isCategory = (v: string | null): v is ServiceCategory => !!v && (SERVICE_CATEGORIES as readonly string[]).includes(v);

/** /services: list ↔ map toggle with a shared category filter; both live in the URL (?view=map&category=wash). */
export function ServicesView() {
  const t = useTranslations('services');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view: View = params.get('view') === 'map' ? 'map' : 'list';
  const rawCategory = params.get('category');
  const category = isCategory(rawCategory) ? rawCategory : undefined;

  const update = useCallback(
    (patch: { view?: View; category?: ServiceCategory | null }) => {
      const next = new URLSearchParams(params.toString());
      if (patch.view !== undefined) {
        if (patch.view === 'map') next.set('view', 'map');
        else next.delete('view');
      }
      if (patch.category !== undefined) {
        if (patch.category) next.set('category', patch.category);
        else next.delete('category');
      }
      const s = next.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('title')}
        description={t('description')}
        className="pb-0"
        actions={
          <Button asChild variant="outline" leadingIcon={<Plus aria-hidden="true" />}>
            <Link href="/services/new">
              <span className="max-[25rem]:hidden">{t('add')}</span>
              <span className="min-[25rem]:hidden">{t('addShort')}</span>
            </Link>
          </Button>
        }
      />
      <SegmentedControl<View>
        label={t('view.label')}
        value={view}
        onValueChange={(v) => update({ view: v })}
        options={[
          { value: 'list', label: t('view.list'), icon: <List aria-hidden="true" /> },
          { value: 'map', label: t('view.map'), icon: <MapIcon aria-hidden="true" /> },
        ]}
        className="sm:max-w-xs"
      />
      <CategoryChips value={category} onChange={(c) => update({ category: c ?? null })} />
      {view === 'map' ? <ServicesMap category={category} /> : <ServicesList category={category} onResetCategory={() => update({ category: null })} />}
    </div>
  );
}
