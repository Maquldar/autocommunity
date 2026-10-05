import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SosEntryView } from '@/features/sos/request-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('sos');
  return { title: t('requestMetaTitle') };
}

export default function SosPage() {
  return <SosEntryView />;
}
