import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PublicLayout } from '@/components/layout/public-layout';
import { PublicSosView } from '@/features/sos/public-view';

/** Public, read-only share link (API.md §4). Outside the (app) auth guard; never indexed. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('sos');
  return {
    title: t('publicMetaTitle'),
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
    referrer: 'no-referrer',
  };
}

export default async function PublicSosPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <PublicLayout>
      <PublicSosView token={token} />
    </PublicLayout>
  );
}
