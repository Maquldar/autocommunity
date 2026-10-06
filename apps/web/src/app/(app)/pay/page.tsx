import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { PayScanView } from '@/features/pay/scan-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pay.scan');
  return { title: t('title') };
}

export default function PayScanPage() {
  return (
    <Suspense>
      <PayScanView />
    </Suspense>
  );
}
