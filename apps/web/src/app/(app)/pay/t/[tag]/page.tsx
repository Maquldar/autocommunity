import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PayPointView } from '@/features/pay/point-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pay.point');
  return { title: t('title') };
}

/** The URL in an NFC sticker / counter QR code: `/pay/t/<payTag>` (an opaque token, never the service id). */
export default async function PayTagPage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = await params;
  return <PayPointView by="tag" value={tag} />;
}
