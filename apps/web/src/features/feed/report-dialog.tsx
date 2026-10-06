'use client';

import { REPORT_LIMITS, type ReportReason } from '@autoc/shared';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormError } from '@/components/ui/form-error';
import { FormField } from '@/components/ui/form-field';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { notify } from '@/lib/toast';
import { useReport } from './api';
import { useFeedErrorMessage } from './errors';

/** Reasons that make sense for posts and comments (`fake_sos` is SOS-only). */
const REASONS = ['spam', 'harassment', 'inappropriate', 'fraud', 'dangerous', 'other'] as const satisfies readonly ReportReason[];

/**
 * Minimal report flow for posts and comments (POST /reports). Phase 5 has no report UI in this branch;
 * when the shared report dialog lands, this can be swapped for it.
 */
export function ReportDialog({
  open,
  onOpenChange,
  targetType,
  targetId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetType: 'post' | 'comment';
  targetId: string;
}) {
  const t = useTranslations('feed.report');
  const tc = useTranslations('common');
  const errorMessage = useFeedErrorMessage();
  const report = useReport();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setReason(null);
      setDetails('');
      setError(null);
    }
  };

  const submit = () => {
    if (!reason) {
      setError(t('chooseReason'));
      return;
    }
    setError(null);
    report.mutate(
      { targetType, targetId, reason, details: details.trim() || undefined },
      {
        onSuccess: () => {
          notify.success(t('sent'));
          close(false);
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent data-testid="report-dialog">
        <DialogHeader>
          <DialogTitle>{targetType === 'post' ? t('titlePost') : t('titleComment')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <RadioGroup value={reason ?? ''} onValueChange={(v) => setReason(v as ReportReason)} aria-label={t('reasonLabel')}>
          {REASONS.map((r) => (
            <div key={r} className="flex min-h-11 items-center gap-3">
              <RadioGroupItem value={r} id={`${id}-${r}`} />
              <Label htmlFor={`${id}-${r}`} className="font-normal">
                {t(`reasons.${r}`)}
              </Label>
            </div>
          ))}
        </RadioGroup>
        <FormField label={`${t('details')} (${tc('optional')})`}>
          <Textarea rows={3} showCount maxLength={REPORT_LIMITS.detailsMax} value={details} onChange={(e) => setDetails(e.target.value)} />
        </FormField>
        <FormError>{error}</FormError>
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>
            {tc('cancel')}
          </Button>
          <Button onClick={submit} loading={report.isPending}>
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
