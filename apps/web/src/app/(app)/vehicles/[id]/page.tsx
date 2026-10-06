import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { VehicleView } from '@/features/vehicles/vehicle-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('vehicles.page');
  return { title: t('metaTitle') };
}

export default async function VehiclePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  return <VehicleView vehicleId={id} initialTab={tab === 'violations' ? 'violations' : 'details'} />;
}
