import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PayPointView } from '@/features/pay/point-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pay.point');
  return { title: t('title') };
}

/** "Оплатить здесь" from a service card or the map. */
export default async function PayServicePage({ params }: { params: Promise<{ serviceId: string }> }) {
  const { serviceId } = await params;
  return <PayPointView by="id" value={serviceId} />;
}
