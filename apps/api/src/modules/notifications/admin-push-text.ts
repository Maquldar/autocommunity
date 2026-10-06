import type { Locale, NotificationType, PushPayload } from '@autoc/shared';

/** Phase 6 notification types (moderation outcomes); everything else is in push-text.ts. */
export const ADMIN_PUSH_TYPES: readonly NotificationType[] = ['admin_warning', 'report_resolved', 'service_status', 'visit_status'];

const formatUntil = (iso: unknown, l: Locale): string | null => {
  if (typeof iso !== 'string') return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(l === 'en' ? 'en-GB' : 'ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Almaty' }).format(d);
};

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const id = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(v) ? v : null);

/** Localized push for the Phase 6 types, or null when the payload lacks what the text needs. */
export function adminPushPayloadFor(type: NotificationType, payload: Record<string, unknown>, l: Locale): PushPayload | null {
  const ru = l === 'ru';
  switch (type) {
    case 'admin_warning': {
      const until = formatUntil(payload.until, l);
      const note = str(payload.note);
      const tag = `admin_warning:${str(payload.kind)}`;
      switch (payload.kind) {
        case 'warning':
          return { title: ru ? 'Предупреждение модератора' : 'Moderator warning', body: note, url: '/notifications', tag };
        case 'blocked':
          return {
            title: ru ? 'Аккаунт заблокирован' : 'Account blocked',
            body: until ? (ru ? `Доступ ограничен до ${until}` : `Access is restricted until ${until}`) : ru ? 'Доступ к аккаунту ограничен' : 'Access to your account is restricted',
            url: '/notifications',
            tag,
          };
        case 'sos_ban':
          return {
            title: ru ? 'SOS временно недоступен' : 'SOS temporarily unavailable',
            body: until ? (ru ? `Вы не можете создавать SOS до ${until}` : `You can't create SOS requests until ${until}`) : '',
            url: '/notifications',
            tag,
          };
        case 'fake_sos':
          return {
            title: ru ? 'SOS признан ложным' : 'SOS marked as fake',
            body: ru ? 'Модератор признал ваш SOS ложным. Рейтинг снижен.' : 'A moderator marked your SOS as fake. Your rating was lowered.',
            url: '/notifications',
            tag,
          };
        default:
          return null;
      }
    }
    case 'report_resolved': {
      const reportId = id(payload.reportId);
      if (!reportId) return null;
      const confirmed = payload.decision === 'confirmed';
      return {
        title: ru ? 'Жалоба рассмотрена' : 'Report reviewed',
        body: confirmed
          ? ru ? 'Спасибо! Нарушение подтверждено, меры приняты.' : 'Thank you! The violation was confirmed and action was taken.'
          : ru ? 'Модератор не нашёл нарушения.' : 'A moderator found no violation.',
        url: '/notifications',
        tag: `report:${reportId}`,
      };
    }
    case 'service_status': {
      const serviceId = id(payload.serviceId);
      if (!serviceId) return null;
      const name = str(payload.serviceName);
      const verified = payload.status === 'verified';
      return {
        title: verified ? (ru ? 'Сервис опубликован' : 'Service published') : ru ? 'Сервис отклонён' : 'Service rejected',
        body: verified
          ? ru ? `«${name}» прошёл проверку и появился в каталоге` : `“${name}” was verified and is now listed`
          : ru ? `«${name}» не прошёл проверку` : `“${name}” didn't pass moderation`,
        url: `/services/${serviceId}`,
        tag: `service:${serviceId}`,
      };
    }
    case 'visit_status': {
      const serviceId = id(payload.serviceId);
      if (!serviceId) return null;
      const name = str(payload.serviceName);
      const verified = payload.status === 'verified';
      return {
        title: verified ? (ru ? 'Визит подтверждён' : 'Visit confirmed') : ru ? 'Визит не подтверждён' : 'Visit not confirmed',
        body: verified
          ? ru ? `Можно оставить отзыв о «${name}»` : `You can now review “${name}”`
          : ru ? `Фото заказа для «${name}» не принято` : `Your order photo for “${name}” wasn't accepted`,
        url: `/services/${serviceId}`,
        tag: `visit:${str(payload.visitId)}`,
      };
    }
    default:
      return null;
  }
}
