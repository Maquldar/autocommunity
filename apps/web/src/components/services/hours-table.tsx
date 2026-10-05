'use client';

import type { ServiceHours } from '@autoc/shared';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { formatRange, hoursRows } from './hours';

/** Weekly hours, Monday first, today's row highlighted (Asia/Almaty). */
export function HoursTable({ hours, now }: { hours: ServiceHours; now: Date }) {
  const t = useTranslations('services.hours');
  const rows = hoursRows(hours, now);
  const known = rows.some((r) => r.value);
  return (
    <Card padding="none" className="overflow-hidden">
      <h2 className="px-4 pb-2 pt-4 text-base font-semibold sm:px-5">{t('title')}</h2>
      {known ? (
        <table className="w-full text-[0.9375rem]">
          <caption className="sr-only">{t('title')}</caption>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day} aria-current={r.isToday ? 'date' : undefined} className={cn(r.isToday && 'bg-primary-soft text-primary-soft-foreground font-semibold')}>
                <th scope="row" className="py-2 ps-4 text-start font-[inherit] sm:ps-5">
                  {t(`days.${r.day}`)}
                  {r.isToday ? <span className="ms-1.5 text-sm font-normal">({t('today')})</span> : null}
                </th>
                <td className={cn('py-2 pe-4 text-end tabular-nums sm:pe-5', !r.value && !r.isToday && 'text-muted-foreground')}>
                  {r.value ? (r.allDay ? t('allDay') : formatRange(r.value)) : t('closed')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="px-4 pb-4 text-sm text-muted-foreground sm:px-5">{t('unknown')}</p>
      )}
      <div className="h-2" aria-hidden="true" />
    </Card>
  );
}
