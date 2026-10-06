'use client';

import { VIOLATION_LIMITS, type ViolationDto } from '@autoc/shared';
import { CalendarDays, CarFront, CircleAlert, MessageSquareWarning, Scale } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/textarea';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { notify } from '@/lib/toast';
import { MediaGrid } from '@/features/feed/media-grid';
import { useDisputeViolation } from './api';
import { checkDisputeText, showsStatus, violationError, VIOLATION_STATUS_TONE } from './view-model';

/** One violation: category, code and article, date, description, evidence photos; status and dispute for the owner. */
export function ViolationCard({ violation, viewerIsOwner, submittedList = false }: { violation: ViolationDto; viewerIsOwner: boolean; submittedList?: boolean }) {
  const t = useTranslations('violations');
  const format = useFormatter();
  const [disputing, setDisputing] = useState(false);
  const v = violation;
  const vehicleName = `${v.vehicle.brand} ${v.vehicle.model}`;

  return (
    <article className="flex flex-col gap-3 rounded-2xl border bg-card p-4" data-testid="violation-card" data-status={v.status} aria-label={t(`categories.${v.category}`)}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{t(`categories.${v.category}`)}</h3>
        {showsStatus(v, viewerIsOwner, submittedList) ? (
          <Badge size="sm" variant={VIOLATION_STATUS_TONE[v.status]} data-testid="violation-status">
            {t(`statuses.${v.status}`)}
          </Badge>
        ) : null}
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <div className="inline-flex items-center gap-1.5">
          <dt className="sr-only">{t('code')}</dt>
          <Scale aria-hidden="true" className="size-4" />
          <dd>
            {t(`codeTypes.${v.codeType}`)}
            {v.article ? ` · ${v.article}` : ''}
          </dd>
        </div>
        <div className="inline-flex items-center gap-1.5">
          <dt className="sr-only">{t('occurredAt')}</dt>
          <CalendarDays aria-hidden="true" className="size-4" />
          <dd>
            <time dateTime={v.occurredAt}>{format.dateTime(new Date(v.occurredAt), { dateStyle: 'medium' })}</time>
          </dd>
        </div>
        {submittedList ? (
          <div className="inline-flex items-center gap-1.5">
            <dt className="sr-only">{t('vehicle')}</dt>
            <CarFront aria-hidden="true" className="size-4" />
            <dd>
              {/* A deleted vehicle keeps its snapshot but has no page (id ''). */}
              {v.vehicle.id ? (
                <Link href={`/vehicles/${v.vehicle.id}`} className="rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-ring">
                  {vehicleName}, {v.vehicle.year}
                </Link>
              ) : (
                <span>
                  {vehicleName}, {v.vehicle.year}
                </span>
              )}
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="whitespace-pre-line break-words text-[0.9375rem]">{v.description}</p>
      <MediaGrid media={v.photos} label={t('photos')} />
      {v.dispute ? (
        <div className="flex flex-col gap-1 rounded-xl bg-primary-soft/60 p-3 text-sm" data-testid="violation-dispute">
          <p className="flex items-center gap-1.5 font-medium">
            <MessageSquareWarning aria-hidden="true" className="size-4" />
            {t('dispute.yours')}
          </p>
          <p className="whitespace-pre-line break-words">{v.dispute.text}</p>
        </div>
      ) : null}
      {v.status === 'pending' && viewerIsOwner ? <p className="text-sm text-muted-foreground">{t('pendingOwnerHint')}</p> : null}
      {v.status === 'disputed' && viewerIsOwner ? <p className="text-sm text-muted-foreground">{t('disputedHint')}</p> : null}
      {v.canDispute ? (
        <div className="flex justify-end border-t pt-3">
          <Button variant="outline" size="sm" leadingIcon={<MessageSquareWarning aria-hidden="true" />} onClick={() => setDisputing(true)} data-testid="violation-dispute-button">
            {t('dispute.action')}
          </Button>
        </div>
      ) : null}
      <DisputeDialog violation={v} open={disputing} onOpenChange={setDisputing} />
    </article>
  );
}

function DisputeDialog({ violation, open, onOpenChange }: { violation: ViolationDto; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('violations.dispute');
  const tv = useTranslations('violations');
  const errorMessage = useErrorMessage();
  const online = useOnlineStatus();
  const dispute = useDisputeViolation();
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setText('');
    setTouched(false);
    setError(null);
  }, [open]);

  const problem = checkDisputeText(text);
  const mapped = error ? violationError(error) : null;
  const errorText = error ? (mapped ? tv(`errors.${mapped.key}`, mapped.values) : errorMessage(error)) : null;

  const submit = async () => {
    setTouched(true);
    if (problem) return;
    setError(null);
    try {
      await dispute.mutateAsync({ id: violation.id, text: text.trim() });
      notify.success(t('sent'));
      onOpenChange(false);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (dispute.isPending ? undefined : onOpenChange(next))}>
      <DialogContent data-testid="dispute-dialog">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{violation.status === 'approved' ? t('descriptionApproved') : t('description')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <FormField
            label={t('text')}
            required
            hint={t('textHint', { min: VIOLATION_LIMITS.disputeMin })}
            error={touched && problem ? t(`textErrors.${problem}`, { min: VIOLATION_LIMITS.disputeMin, max: VIOLATION_LIMITS.disputeMax }) : undefined}
          >
            <Textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={() => setTouched(true)} maxLength={VIOLATION_LIMITS.disputeMax} showCount rows={4} data-testid="dispute-text" />
          </FormField>
          {errorText ? (
            <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {errorText}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={dispute.isPending}>
              {t('cancel')}
            </Button>
            <Button type="submit" loading={dispute.isPending} disabled={!online}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
