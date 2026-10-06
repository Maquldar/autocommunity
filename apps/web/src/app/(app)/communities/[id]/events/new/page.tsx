import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { NewEventView } from '@/features/events/event-editor-views';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('events.form');
  return { title: t('createTitle') };
}

export default async function NewEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NewEventView communityId={id} />;
}
