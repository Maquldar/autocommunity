import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CheckoutView } from '@/features/wallet/checkout-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('wallet.checkout');
  return { title: t('title') };
}

export default async function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CheckoutView topupId={id} />;
}
