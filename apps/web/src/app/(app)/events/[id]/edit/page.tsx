import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { EditEventView } from '@/features/events/event-editor-views';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('events.form');
  return { title: t('editTitle') };
}

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditEventView id={id} />;
}
