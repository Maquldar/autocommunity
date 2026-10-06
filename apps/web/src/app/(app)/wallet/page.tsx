import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WalletView } from '@/features/wallet/wallet-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('wallet');
  return { title: t('title') };
}

export default function WalletPage() {
  return <WalletView />;
}
