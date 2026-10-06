'use client';

import { SearchX } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { useCurrentUser } from '@/lib/auth/guards';

/** The same "page not found" a missing page shows: the admin area doesn't reveal itself to others. */
export function AdminNotFound() {
  const t = useTranslations('admin.notFound');
  return (
    <div className="flex flex-col items-center px-6 py-20 text-center" data-testid="not-found">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <SearchX aria-hidden="true" className="size-7" strokeWidth={1.75} />
      </div>
      <p className="text-sm font-semibold tracking-wide text-muted-foreground">404</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-1.5 max-w-sm text-[0.9375rem] text-muted-foreground">{t('description')}</p>
      <Link href="/map" className={buttonVariants({ variant: 'primary', className: 'mt-6' })}>
        {t('home')}
      </Link>
    </div>
  );
}

/** Renders the admin area for `role = admin` only (the API enforces it too: every /admin route is 403). */
export function AdminGate({ children }: { children: ReactNode }) {
  const me = useCurrentUser();
  if (me.role !== 'admin') return <AdminNotFound />;
  return <>{children}</>;
}
