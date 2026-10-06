import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PremiumView } from '@/features/premium/premium-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('premium');
  return { title: t('title') };
}

export default function PremiumPage() {
  return <PremiumView />;
}
