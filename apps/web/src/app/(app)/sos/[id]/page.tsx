import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SosLiveView } from '@/features/sos/live-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('sos');
  return { title: t('liveMetaTitle') };
}

export default async function SosLivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SosLiveView id={id} />;
}
