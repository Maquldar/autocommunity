import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SosHistoryView } from '@/features/sos/list-views';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('sos');
  return { title: t('historyMetaTitle') };
}

export default function SosHistoryPage() {
  return <SosHistoryView />;
}
