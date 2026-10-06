import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { PayReceiptView } from '@/features/pay/receipt-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pay.receipt');
  return { title: t('title') };
}

export default async function PayReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <PayReceiptView orderId={id} />
    </Suspense>
  );
}
