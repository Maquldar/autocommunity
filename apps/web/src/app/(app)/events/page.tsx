import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { EventsView } from '@/features/events/events-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('events');
  return { title: t('metaTitle') };
}

export default function EventsPage() {
  return <EventsView />;
}
