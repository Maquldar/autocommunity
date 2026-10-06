'use client';

import { VIOLATION_CATEGORIES, VIOLATION_CODE_TYPES, VIOLATION_LIMITS, type ViolationCategory, type ViolationCodeType } from '@autoc/shared';
import { CircleAlert, Info, ShieldAlert, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { PhotosField, type DraftPhoto } from '@/components/photos-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Textarea } from '@/components/ui/textarea';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { useCurrentUser } from '@/lib/auth/guards';
import { notify } from '@/lib/toast';
import { useCreateViolation } from './api';
import { checkViolationDraft, defaultCodeType, minViolationDate, submitEligibility, toDateInput, violationError, type ViolationFieldErrors } from './view-model';

type Slot = { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean | 'true' | 'false' };

function CategorySelect({ value, onChange, ...aria }: Slot & { value: ViolationCategory | null; onChange: (v: ViolationCategory) => void }) {
  const t = useTranslations('violations');
  return (
    <Select value={value ?? undefined} onValueChange={(v) => onChange(v as ViolationCategory)}>
      <SelectTrigger id={aria.id} aria-describedby={aria['aria-describedby']} aria-invalid={aria['aria-invalid']} data-testid="violation-category">
        <SelectValue placeholder={t('form.categoryPlaceholder')} />
      </SelectTrigger>
      <SelectContent>
        {VIOLATION_CATEGORIES.map((c) => (
          <SelectItem key={c} value={c}>
            {t(`categories.${c}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * "Report a violation" on a vehicle page: category, КоАП / УК, optional article, date, description and 1–3
 * evidence photos (purpose `violation`). It is published only after a moderator approves it; false reports
 * cost the reporter rating. Eligibility (account age, rating) is checked before the form and again on send.
 */
export function ReportViolationDialog({
  vehicle,
  open,
  onOpenChange,
}: {
  vehicle: { id: string; brand: string; model: string; ownerId: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="violation-dialog">
        {open ? <Body vehicle={vehicle} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Body({ vehicle, onDone }: { vehicle: { id: string; brand: string; model: string; ownerId: string }; onDone: () => void }) {
  const t = useTranslations('violations');
  const me = useCurrentUser();
  const online = useOnlineStatus();
  const errorMessage = useErrorMessage();
  const create = useCreateViolation(vehicle.id);
  const [category, setCategory] = useState<ViolationCategory | null>(null);
  const [codeType, setCodeType] = useState<ViolationCodeType>('koap');
  const [codeTouched, setCodeTouched] = useState(false);
  const [article, setArticle] = useState('');
  const [date, setDate] = useState(() => toDateInput(new Date()));
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<ViolationFieldErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const onBusyChange = useCallback((busy: boolean) => setUploading(busy), []);
  const eligibility = submitEligibility(me, vehicle.ownerId);
  const name = `${vehicle.brand} ${vehicle.model}`;

  const draft = { category, codeType, article, date, description, photoIds: photos.map((p) => p.id) };
  useEffect(() => {
    if (submitted) {
      const result = checkViolationDraft(draft);
      setErrors(result.ok ? {} : result.errors);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-validate live after the first submit
  }, [submitted, category, codeType, article, date, description, photos]);

  const submit = async () => {
    setSubmitted(true);
    const result = checkViolationDraft(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setError(null);
    try {
      await create.mutateAsync(result.body);
      notify.success(t('form.sent'));
      onDone();
    } catch (err) {
      setError(err);
    }
  };

  const mapped = error ? violationError(error) : null;
  const errorText = error ? (mapped ? t(`errors.${mapped.key}`, mapped.values) : errorMessage(error)) : null;
  const fieldError = (key: keyof ViolationFieldErrors) =>
    errors[key] ? t(`form.errors.${errors[key]}`, { min: VIOLATION_LIMITS.descriptionMin, max: VIOLATION_LIMITS.descriptionMax, article: VIOLATION_LIMITS.articleMax, photosMin: VIOLATION_LIMITS.photosMin, photosMax: VIOLATION_LIMITS.photosMax }) : undefined;

  if (eligibility.key !== 'ok') {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{t('form.title')}</DialogTitle>
          <DialogDescription>{name}</DialogDescription>
        </DialogHeader>
        <p role="status" className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground" data-testid="violation-eligibility">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {eligibility.key === 'accountTooNew' ? t('errors.accountTooNew', { days: eligibility.days }) : t('errors.ratingTooLow', { min: eligibility.min })}
        </p>
        <DialogFooter>
          <Button variant="secondary" onClick={onDone}>
            {t('form.close')}
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('form.title')}</DialogTitle>
        <DialogDescription>{t('form.description', { name })}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2 rounded-xl bg-muted/60 p-3 text-sm">
        <p className="flex items-start gap-2">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          {t('form.moderationNote')}
        </p>
        <p className="flex items-start gap-2">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
          {t('form.falseReportNote')}
        </p>
      </div>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FormField label={t('form.category')} required error={fieldError('category')}>
          <CategorySelect
            value={category}
            onChange={(c) => {
              setCategory(c);
              if (!codeTouched) setCodeType(defaultCodeType(c));
            }}
          />
        </FormField>
        <div className="flex flex-col gap-1.5">
          <span className="text-[0.9375rem] font-medium">{t('form.codeType')}</span>
          <SegmentedControl
            label={t('form.codeType')}
            value={codeType}
            onValueChange={(v) => {
              setCodeType(v);
              setCodeTouched(true);
            }}
            options={VIOLATION_CODE_TYPES.map((c) => ({ value: c, label: t(`codeTypes.${c}`) }))}
          />
          <p className="text-sm text-muted-foreground">{t('form.codeTypeHint')}</p>
        </div>
        <FormField label={t('form.article')} hint={t('form.articleHint')} error={fieldError('article')}>
          <Input value={article} onChange={(e) => setArticle(e.target.value)} maxLength={VIOLATION_LIMITS.articleMax} placeholder={t('form.articlePlaceholder')} autoComplete="off" data-testid="violation-article" />
        </FormField>
        <FormField label={t('form.date')} required error={fieldError('date')}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={toDateInput(new Date())} min={minViolationDate()} data-testid="violation-date" />
        </FormField>
        <FormField label={t('form.text')} required hint={t('form.textHint', { min: VIOLATION_LIMITS.descriptionMin })} error={fieldError('description')}>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={VIOLATION_LIMITS.descriptionMax} showCount rows={4} data-testid="violation-description" />
        </FormField>
        <div className="flex flex-col gap-1.5">
          <span className="text-[0.9375rem] font-medium">
            {t('form.photos')} <span aria-hidden="true" className="text-danger">*</span>
          </span>
          <p className="text-sm text-muted-foreground">{t('form.photosHint', { min: VIOLATION_LIMITS.photosMin, max: VIOLATION_LIMITS.photosMax })}</p>
          <PhotosField
            purpose="violation"
            max={VIOLATION_LIMITS.photosMax}
            value={photos}
            onChange={setPhotos}
            onBusyChange={onBusyChange}
            label={t('form.photos')}
            invalid={Boolean(errors.photos)}
            testId="violation-photo"
          />
          {errors.photos ? (
            <p className="flex items-center gap-1.5 text-sm text-danger">
              <CircleAlert aria-hidden="true" className="size-4" />
              {fieldError('photos')}
            </p>
          ) : null}
        </div>
        {errorText ? (
          <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground" data-testid="violation-error">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {errorText}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onDone} disabled={create.isPending}>
            {t('form.cancel')}
          </Button>
          <Button type="submit" loading={create.isPending} disabled={!online || uploading}>
            {t('form.submit')}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
