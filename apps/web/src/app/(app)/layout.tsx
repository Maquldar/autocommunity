import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { PageSkeleton, SignedInShell } from '@/components/layout/signed-in-shell';

export default async function SignedInLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('states');
  return <SignedInShell fallback={<PageSkeleton label={t('loading')} />}>{children}</SignedInShell>;
}
