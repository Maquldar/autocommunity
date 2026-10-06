import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { FraudView } from '@/features/admin/fraud-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.fraud');
  return { title: t('title') };
}

export default function AdminFraudPage() {
  return <FraudView />;
}
