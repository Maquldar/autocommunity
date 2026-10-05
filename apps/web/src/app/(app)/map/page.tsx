import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MapView } from '@/features/map/map-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('map');
  return { title: t('metaTitle') };
}

export default function MapPage() {
  return <MapView />;
}
