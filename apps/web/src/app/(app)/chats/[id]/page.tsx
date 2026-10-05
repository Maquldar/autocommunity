import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ConversationView } from '@/features/chats/conversation-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('chats.conversation');
  return { title: t('metaTitle') };
}

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ConversationView chatId={id} />;
}
