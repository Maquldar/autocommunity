'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/** "Receive SOS alerts nearby" switch with its explanation. */
export function ReceiveSosRow({
  checked,
  onCheckedChange,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('settings.sos');
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border bg-card p-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <Label htmlFor={id} className="text-[0.9375rem]">
          {t('label')}
        </Label>
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {t('hint')}
        </p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-describedby={`${id}-hint`} />
    </div>
  );
}
