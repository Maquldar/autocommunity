'use client';

import type { ServiceHours } from '@autoc/shared';
import { Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { describeOpenState } from './hours';

/** "Open until 19:00" in success colour or "Closed · opens tomorrow at 09:00" in muted text. */
export function OpenStateLine({ hours, now, className }: { hours: ServiceHours; now: Date; className?: string }) {
  const t = useTranslations('services.hours');
  const s = describeOpenState(hours, now);
  let text: string;
  let open = false;
  switch (s.kind) {
    case 'unknown':
      text = t('unknown');
      break;
    case 'open24':
      text = t('open24');
      open = true;
      break;
    case 'openUntil':
      text = s.nextDay ? t('openUntilNextDay', { time: s.time }) : t('openUntil', { time: s.time });
      open = true;
      break;
    case 'opensAt':
      text = t('opensAt', { time: s.time });
      break;
    case 'opensTomorrow':
      text = t('opensTomorrow', { time: s.time });
      break;
    case 'opensOn':
      text = t('opensOn', { day: t(`daysShort.${s.day}`), time: s.time });
      break;
    default:
      text = t('closedForNow');
  }
  return (
    <p className={cn('flex items-center gap-1.5 text-[0.9375rem] font-medium', open ? 'text-success' : 'text-muted-foreground', className)}>
      <Clock aria-hidden="true" className="size-4 shrink-0" />
      {text}
    </p>
  );
}
