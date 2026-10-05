'use client';

import { MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, type ButtonProps } from '@/components/ui/button';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { useOpenDirectChat } from './queries';

/** "Message": POST /chats/direct (get or create), then opens /chats/[id]. On profiles and the map card. */
export function MessageButton({ userId, ...props }: { userId: string } & Pick<ButtonProps, 'size' | 'fullWidth' | 'variant' | 'className'>) {
  const t = useTranslations('chats.actions');
  const online = useOnlineStatus();
  const open = useOpenDirectChat();
  return (
    <Button
      variant="secondary"
      leadingIcon={<MessageCircle aria-hidden="true" />}
      loading={open.isPending}
      disabled={!online}
      onClick={() => open.mutate(userId)}
      {...props}
    >
      {t('message')}
    </Button>
  );
}
