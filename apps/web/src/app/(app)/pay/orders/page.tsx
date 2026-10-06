import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PayOrdersView } from '@/features/pay/receipt-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pay.orders');
  return { title: t('title') };
}

export default function PayOrdersPage() {
  return <PayOrdersView />;
}
