import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { NearbySosView } from '@/features/sos/list-views';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('sos');
  return { title: t('nearbyMetaTitle') };
}

export default function NearbySosPage() {
  return <NearbySosView />;
}
