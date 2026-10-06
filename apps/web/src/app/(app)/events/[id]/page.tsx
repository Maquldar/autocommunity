import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { EventDetailsView } from '@/features/events/event-details-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('events');
  return { title: t('metaTitle') };
}

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EventDetailsView id={id} />;
}
