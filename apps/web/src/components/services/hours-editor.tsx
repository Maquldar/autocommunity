'use client';

import { WEEKDAYS, type ServiceHours, type Weekday } from '@autoc/shared';
import { CircleAlert, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { copyMondayToWeekdays, dayEditorFromValue, dayEditorToValue, type DayEditor } from './hours';

function Check({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn('inline-flex min-h-11 cursor-pointer items-center gap-2 text-[0.9375rem]', disabled && 'cursor-not-allowed opacity-50')}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-5 shrink-0 cursor-pointer rounded accent-primary focus-ring"
      />
      {label}
    </label>
  );
}

function DayRow({ day, value, onChange, error }: { day: Weekday; value: string | null; onChange: (v: string | null) => void; error?: string }) {
  const t = useTranslations('services');
  const errorId = useId();
  const e = dayEditorFromValue(value);
  const set = (patch: Partial<DayEditor>) => onChange(dayEditorToValue({ ...e, ...patch }));
  const dayName = t(`hours.days.${day}`);
  return (
    <fieldset className="flex flex-col gap-1 border-t py-2 first:border-t-0" aria-describedby={error ? errorId : undefined}>
      <legend className="sr-only">{t('submit.dayHours', { day: dayName })}</legend>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span aria-hidden="true" className="w-28 shrink-0 font-medium">
          {dayName}
        </span>
        <Check checked={e.open} onChange={(open) => set({ open })} label={t('submit.open')} />
        <Check checked={e.open && e.allDay} disabled={!e.open} onChange={(allDay) => set({ allDay })} label={t('submit.allDay')} />
      </div>
      {e.open && !e.allDay ? (
        <div className="flex flex-wrap items-center gap-2 sm:ps-32">
          <Input
            type="time"
            aria-label={`${dayName}: ${t('submit.from')}`}
            value={e.from}
            onChange={(ev) => set({ from: ev.target.value })}
            aria-invalid={error ? true : undefined}
            className="w-32"
          />
          <span aria-hidden="true">–</span>
          <Input
            type="time"
            aria-label={`${dayName}: ${t('submit.to')}`}
            value={e.to}
            onChange={(ev) => set({ to: ev.target.value })}
            aria-invalid={error ? true : undefined}
            className="w-32"
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground sm:ps-32">{e.open ? t('hours.allDay') : t('hours.closed')}</p>
      )}
      {error ? (
        <p id={errorId} className="flex items-start gap-1.5 text-sm text-danger sm:ps-32">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Weekly hours editor: open / 24 h per day, opening and closing time, "copy Monday to weekdays". */
export function HoursEditor({
  value,
  onChange,
  errors,
  labelId,
}: {
  value: ServiceHours;
  onChange: (v: ServiceHours) => void;
  errors?: Partial<Record<Weekday, string>>;
  labelId: string;
}) {
  const t = useTranslations('services.submit');
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col">
      <div className="rounded-xl border bg-card px-3 sm:px-4">
        {WEEKDAYS.map((day) => (
          <DayRow key={day} day={day} value={value[day]} error={errors?.[day]} onChange={(v) => onChange({ ...value, [day]: v })} />
        ))}
      </div>
      <Button variant="ghost" size="sm" leadingIcon={<Copy aria-hidden="true" />} className="mt-1 self-start" onClick={() => onChange(copyMondayToWeekdays(value))}>
        {t('copyWeekdays')}
      </Button>
    </div>
  );
}
