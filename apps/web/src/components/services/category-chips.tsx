'use client';

import { SERVICE_CATEGORIES, type ServiceCategory } from '@autoc/shared';
import { LayoutGrid } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { CATEGORY_META } from './category';

/** Single-choice category filter as a scrollable row of toggle chips ("All" + 5 categories). */
export function CategoryChips({
  value,
  onChange,
  className,
}: {
  value: ServiceCategory | undefined;
  onChange: (value: ServiceCategory | undefined) => void;
  className?: string;
}) {
  const t = useTranslations('services');
  const options: { value: ServiceCategory | undefined; label: string; icon: typeof LayoutGrid }[] = [
    { value: undefined, label: t('categories.all'), icon: LayoutGrid },
    ...SERVICE_CATEGORIES.map((c) => ({ value: c, label: t(`categories.${c}`), icon: CATEGORY_META[c].icon })),
  ];
  return (
    <div
      role="group"
      aria-label={t('categoryFilter')}
      className={cn('-mx-4 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:hidden', className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value ?? 'all'}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium focus-ring',
              'transition-[background-color,border-color,color] duration-fast ease-standard',
              active
                ? 'border-primary bg-primary-soft text-primary-soft-foreground'
                : 'border-border bg-card text-foreground hover:border-input hover:bg-accent',
            )}
          >
            <Icon aria-hidden="true" className="size-4" strokeWidth={active ? 2.25 : 1.75} />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
