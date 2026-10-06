'use client';

import { REPORT_LIMITS, type ReportReason, type ReportTargetType } from '@autoc/shared';
import { CircleAlert, Flag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { notify } from '@/lib/toast';
import { useCreateReport } from './api';
import { reasonsFor, reportError } from './reasons';

export type ReportTarget = { type: ReportTargetType; id: string };

/**
 * "Report" dialog: a reason (fake_sos only for SOS), optional details, submit. Errors stay inside the
 * dialog (already reported, daily limit, own content). Reports go to moderators; nobody else is told.
 */
export function ReportDialog({ target, open, onOpenChange }: { target: ReportTarget | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('reports');
  const errorMessage = useErrorMessage();
  const online = useOnlineStatus();
  const create = useCreateReport();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [missingReason, setMissingReason] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const groupId = useId();

  useEffect(() => {
    if (!open) return;
    setReason(null);
    setDetails('');
    setMissingReason(false);
    setError(null);
  }, [open, target?.id]);

  if (!target) return null;
  const reasons = reasonsFor(target.type);
  const mapped = error ? reportError(error) : null;
  const errorText = error ? (mapped ? t(`errors.${mapped.key}`, { minutes: mapped.minutes ?? 0 }) : errorMessage(error)) : null;

  const submit = async () => {
    if (!reason) {
      setMissingReason(true);
      return;
    }
    setError(null);
    try {
      await create.mutateAsync({ targetType: target.type, targetId: target.id, reason, details: details.trim() || undefined });
      notify.success(t('sent'));
      onOpenChange(false);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (create.isPending ? undefined : onOpenChange(next))}>
      <DialogContent className="max-w-md" data-testid="report-dialog">
        <DialogHeader>
          <DialogTitle>{t(`title.${target.type}`)}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset className="flex flex-col gap-2" aria-describedby={missingReason ? `${groupId}-error` : undefined}>
            <legend id={groupId} className="mb-1 text-[0.9375rem] font-medium">
              {t('reasonLabel')}
            </legend>
            <RadioGroup
              value={reason ?? ''}
              onValueChange={(v) => {
                setReason(v as ReportReason);
                setMissingReason(false);
              }}
              aria-labelledby={groupId}
              aria-invalid={missingReason || undefined}
              className="flex flex-col gap-1"
            >
              {reasons.map((r) => (
                <label key={r} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-accent">
                  <RadioGroupItem value={r} className="mt-0.5" aria-labelledby={`${groupId}-${r}`} aria-describedby={`${groupId}-${r}-hint`} />
                  <span className="flex min-w-0 flex-col">
                    <span id={`${groupId}-${r}`} className="text-[0.9375rem] font-medium">
                      {t(`reasons.${r}`)}
                    </span>
                    <span id={`${groupId}-${r}-hint`} className="text-sm text-muted-foreground">
                      {t(`reasonHints.${r}`)}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>
            {missingReason ? (
              <p id={`${groupId}-error`} className="flex items-center gap-1.5 text-sm text-danger">
                <CircleAlert aria-hidden="true" className="size-4" />
                {t('reasonRequired')}
              </p>
            ) : null}
          </fieldset>
          <FormField label={t('detailsLabel')} hint={t('detailsHint')}>
            <Textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={REPORT_LIMITS.detailsMax} showCount rows={3} />
          </FormField>
          {errorText ? (
            <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground" data-testid="report-error">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {errorText}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={create.isPending}>
              {t('cancel')}
            </Button>
            <Button type="submit" variant="danger" loading={create.isPending} disabled={!online}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A quiet "Report" button that owns its dialog. */
export function ReportButton({
  target,
  label,
  ...props
}: { target: ReportTarget; label?: ReactNode } & Pick<ButtonProps, 'size' | 'variant' | 'className' | 'fullWidth'>) {
  const t = useTranslations('reports');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" leadingIcon={<Flag aria-hidden="true" />} onClick={() => setOpen(true)} data-testid="report-button" {...props}>
        {label ?? t('action')}
      </Button>
      <ReportDialog target={target} open={open} onOpenChange={setOpen} />
    </>
  );
}
