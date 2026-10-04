import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Styleguide } from './styleguide';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('styleguide');
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default function DesignPage() {
  return <Styleguide />;
}
