import type { Locale, NotificationType, PushPayload, UserMini } from '@autoc/shared';

/** Phase 9 notification types (wallet, premium, votes, violations); everything else is in push-text.ts. */
export const PHASE9_PUSH_TYPES = [
  'wallet_received',
  'wallet_admin',
  'premium_reminder',
  'premium_renewed',
  'premium_expired',
  'vote_received',
  'violation_reported',
  'violation_status',
] as const satisfies readonly NotificationType[];
export type Phase9NotificationType = (typeof PHASE9_PUSH_TYPES)[number];

export const isPhase9Type = (t: NotificationType): t is Phase9NotificationType => (PHASE9_PUSH_TYPES as readonly string[]).includes(t);

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const id = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(v) ? v : null);

const coins = (n: number, l: Locale) => `${new Intl.NumberFormat(l === 'en' ? 'en-US' : 'ru-RU').format(n)} ${l === 'en' ? 'coins' : 'монет'}`;
const date = (iso: unknown, l: Locale): string | null => {
  if (typeof iso !== 'string') return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(l === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'long', timeZone: 'Asia/Almaty' }).format(d);
};
const actorLabel = (u: UserMini | undefined) => (!u ? '' : u.name && u.nickname ? `${u.name} (@${u.nickname})` : u.name || `@${u.nickname}`);

const VOTE_REASON: Record<Locale, Record<string, string>> = {
  ru: { rude: 'грубость', dangerous_driving: 'опасное вождение', scam: 'мошенничество', other: 'другое' },
  en: { rude: 'rude', dangerous_driving: 'dangerous driving', scam: 'scam', other: 'other' },
};

const VIOLATION_CATEGORY: Record<Locale, Record<string, string>> = {
  ru: {
    speeding: 'превышение скорости',
    red_light: 'проезд на красный',
    drunk_driving: 'вождение в нетрезвом виде',
    wrong_lane: 'выезд на встречную / не та полоса',
    no_license: 'езда без прав',
    accident_fled: 'оставление места ДТП',
    dangerous_driving: 'опасное вождение',
    parking: 'нарушение парковки',
    other: 'другое нарушение',
  },
  en: {
    speeding: 'speeding',
    red_light: 'running a red light',
    drunk_driving: 'drunk driving',
    wrong_lane: 'wrong lane / oncoming lane',
    no_license: 'driving without a license',
    accident_fled: 'leaving the scene of an accident',
    dangerous_driving: 'dangerous driving',
    parking: 'parking violation',
    other: 'other violation',
  },
};

/** Localized push for the Phase 9 types, or null when the payload lacks what the text needs. */
export function phase9PushPayloadFor(type: Phase9NotificationType, payload: Record<string, unknown>, l: Locale): PushPayload | null {
  const ru = l === 'ru';
  switch (type) {
    case 'wallet_received': {
      const amount = num(payload.amount);
      const txId = id(payload.transactionId);
      if (amount === null || !txId) return null;
      const who = actorLabel(payload.user as UserMini | undefined) || (ru ? 'Пользователь' : 'Someone');
      const message = str(payload.message);
      const body = ru ? `${who} перевёл(а) вам ${coins(amount, l)}` : `${who} sent you ${coins(amount, l)}`;
      return { title: ru ? 'Перевод монет' : 'Coins received', body: message ? `${body}: «${message}»` : body, url: '/wallet', tag: `wallet_received:${txId}` };
    }
    case 'wallet_admin': {
      const note = str(payload.note);
      const tag = `wallet_admin:${str(payload.action) || 'change'}`;
      switch (payload.action) {
        case 'adjust': {
          const amount = num(payload.amount);
          if (amount === null) return null;
          const signed = `${amount > 0 ? '+' : '−'}${coins(Math.abs(amount), l)}`;
          return { title: ru ? 'Баланс изменён' : 'Balance adjusted', body: note ? `${signed} · ${note}` : signed, url: '/wallet', tag };
        }
        case 'freeze':
          return { title: ru ? 'Кошелёк заморожен' : 'Wallet frozen', body: note || (ru ? 'Операции с монетами временно недоступны' : 'Coin operations are suspended'), url: '/wallet', tag };
        case 'unfreeze':
          return { title: ru ? 'Кошелёк разморожен' : 'Wallet unfrozen', body: note || (ru ? 'Операции с монетами снова доступны' : 'Coin operations are available again'), url: '/wallet', tag };
        default:
          return null;
      }
    }
    case 'premium_reminder': {
      const end = date(payload.periodEnd, l);
      if (!end) return null;
      const price = num(payload.priceCoins) ?? 0;
      const tag = 'premium:reminder';
      if (payload.autoRenew !== true)
        return { title: ru ? 'Премиум скоро закончится' : 'Premium ends soon', body: ru ? `Премиум действует до ${end}` : `Premium is active until ${end}`, url: '/premium', tag };
      if (payload.lowBalance === true)
        return {
          title: ru ? 'Пополните баланс' : 'Top up your balance',
          body: ru ? `${end} премиум продлится за ${coins(price, l)} — сейчас монет не хватает` : `Premium renews on ${end} for ${coins(price, l)} — your balance is too low`,
          url: '/wallet',
          tag,
        };
      return {
        title: ru ? 'Премиум скоро продлится' : 'Premium renews soon',
        body: ru ? `${end} спишем ${coins(price, l)}` : `We'll charge ${coins(price, l)} on ${end}`,
        url: '/premium',
        tag,
      };
    }
    case 'premium_renewed': {
      const end = date(payload.periodEnd, l);
      if (!end) return null;
      const price = num(payload.priceCoins) ?? 0;
      return {
        title: ru ? 'Премиум продлён' : 'Premium renewed',
        body: ru ? `Списано ${coins(price, l)}, действует до ${end}` : `${coins(price, l)} charged, active until ${end}`,
        url: '/premium',
        tag: 'premium:renewed',
      };
    }
    case 'premium_expired': {
      const reason = str(payload.reason);
      const body =
        reason === 'insufficient_funds'
          ? ru ? 'Не хватило монет для продления' : 'Not enough coins to renew'
          : reason === 'wallet_frozen'
            ? ru ? 'Кошелёк заморожен, продление невозможно' : "Your wallet is frozen, so it couldn't renew"
            : ru ? 'Срок подписки истёк' : 'Your subscription period has ended';
      return { title: ru ? 'Премиум закончился' : 'Premium ended', body, url: '/premium', tag: 'premium:expired' };
    }
    case 'vote_received': {
      const voteId = id(payload.voteId);
      if (!voteId) return null;
      const reason = VOTE_REASON[l][str(payload.reason)] ?? VOTE_REASON[l].other!;
      return {
        title: ru ? 'Отрицательная оценка' : 'Negative vote',
        body: ru ? `Водитель поставил вам минус: ${reason}` : `A driver voted you down: ${reason}`,
        url: '/profile?tab=votes',
        tag: `vote_received:${voteId}`,
      };
    }
    case 'violation_reported': {
      const vehicleId = id(payload.vehicleId);
      if (!vehicleId) return null;
      const category = VIOLATION_CATEGORY[l][str(payload.category)] ?? VIOLATION_CATEGORY[l].other!;
      const vehicle = str(payload.vehicle);
      return {
        title: ru ? 'Сообщение о нарушении' : 'Violation reported',
        body: ru ? `${vehicle ? `${vehicle}: ` : ''}${category}. Сообщение на проверке, его можно оспорить.` : `${vehicle ? `${vehicle}: ` : ''}${category}. It is under review; you can dispute it.`,
        url: `/vehicles/${vehicleId}?tab=violations`,
        tag: `violation:${str(payload.violationId) || vehicleId}`,
      };
    }
    case 'violation_status': {
      const vehicleId = id(payload.vehicleId);
      if (!vehicleId) return null;
      const category = VIOLATION_CATEGORY[l][str(payload.category)] ?? VIOLATION_CATEGORY[l].other!;
      const owner = payload.role !== 'submitter';
      const status = str(payload.status);
      const title =
        status === 'approved'
          ? owner ? (ru ? 'Нарушение подтверждено' : 'Violation confirmed') : ru ? 'Ваше сообщение подтверждено' : 'Your report was confirmed'
          : status === 'removed'
            ? ru ? 'Нарушение снято' : 'Violation removed'
            : ru ? 'Сообщение отклонено' : 'Report rejected';
      return { title, body: category, url: `/vehicles/${vehicleId}?tab=violations`, tag: `violation:${str(payload.violationId) || vehicleId}` };
    }
  }
}
