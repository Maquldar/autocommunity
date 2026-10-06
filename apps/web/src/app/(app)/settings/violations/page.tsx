import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MyViolationsView } from '@/features/violations/my-violations-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('violations.mine');
  return { title: t('title') };
}

export default function MyViolationsPage() {
  return <MyViolationsView />;
}
