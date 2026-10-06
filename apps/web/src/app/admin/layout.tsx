import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { PageSkeleton, SignedInShell } from '@/components/layout/signed-in-shell';
import { AdminGate } from '@/features/admin/admin-gate';
import { AdminNav } from '@/features/admin/admin-nav';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin');
  return { title: { default: t('metaTitle'), template: `%s · ${t('metaTitle')} · AutoCommunity` }, robots: { index: false, follow: false } };
}

/** /admin: the signed-in shell, then a role gate (non-admins get a not-found page), then the section tabs. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('states');
  return (
    <SignedInShell fallback={<PageSkeleton label={t('loading')} />}>
      <AdminGate>
        <div className="flex flex-col gap-2">
          <AdminNav />
          {children}
        </div>
      </AdminGate>
    </SignedInShell>
  );
}
