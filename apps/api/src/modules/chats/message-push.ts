import type { MessageDto, PushPayload } from '@autoc/shared';

const PREVIEW_MAX = 120;

const MEDIA: Record<'ru' | 'en', Record<'photo' | 'location' | 'voice' | 'system', string>> = {
  ru: { photo: '📷 Фото', location: '📍 Геопозиция', voice: '🎤 Голосовое сообщение', system: 'Сообщение' },
  en: { photo: '📷 Photo', location: '📍 Location', voice: '🎤 Voice message', system: 'Message' },
};

/** Localized Web Push for a direct message: title = sender, body = text preview or a media label. */
export function messagePushPayload(message: MessageDto, locale: string): PushPayload {
  const l = locale === 'en' ? 'en' : 'ru';
  const text = message.text?.replace(/\s+/g, ' ').trim();
  const media = message.type === 'text' ? '' : MEDIA[l][message.type];
  const body = message.type === 'photo' && text ? `${media}: ${text}` : text || media;
  return {
    title: message.sender.name || `@${message.sender.nickname}`,
    body: body.length > PREVIEW_MAX ? `${body.slice(0, PREVIEW_MAX - 1)}…` : body,
    url: `/chats/${message.chatId}`,
    tag: `chat:${message.chatId}`,
  };
}
