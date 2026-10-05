'use client';

import { createServiceSchema, SERVICE_CATEGORIES, SERVICE_LIMITS, WEEKDAYS, type Weekday } from '@autoc/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FormError } from '@/components/ui/form-error';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { PhoneInput } from '@/components/ui/phone-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { hasErrorCode, isApiError } from '@/lib/api/errors';
import { applyApiError } from '@/lib/forms/apply-api-error';
import { fieldErrorText } from '@/lib/forms/field-error';
import { useZodErrorMap } from '@/lib/forms/zod-error-map';
import { useCreateService } from './api';
import { CATEGORY_META } from './category';
import { useServiceErrorMessage } from './errors';
import { DEFAULT_HOURS } from './hours';
import { HoursEditor } from './hours-editor';
import { PhotosField, type PhotoItem } from './photos-field';

const LocationPicker = dynamic(() => import('./location-picker').then((m) => m.LocationPicker), {
  ssr: false,
  loading: () => <Skeleton className="h-72 w-full rounded-xl sm:h-80" />,
});

type FormInput = z.input<typeof createServiceSchema>;
type FormOutput = z.output<typeof createServiceSchema>;

/** /services/new: submit a service for moderation → its pending page. */
export function SubmitServiceView() {
  const t = useTranslations('services');
  const tf = useTranslations('form');
  const router = useRouter();
  const errorMessage = useServiceErrorMessage();
  const create = useCreateService();
  const hoursLabelId = useId();
  const locationErrorId = useId();
  const photosHintId = useId();
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createServiceSchema, { error: useZodErrorMap() }),
    defaultValues: { name: '', description: '', address: '', phone: '', hours: DEFAULT_HOURS, photoUploadIds: [] },
    mode: 'onTouched',
  });
  const { errors } = form.formState;

  const hoursErrors: Partial<Record<Weekday, string>> = {};
  for (const day of WEEKDAYS) if (errors.hours?.[day]) hoursErrors[day] = t('submit.hoursInvalid');
  const locationError = errors.lat || errors.lng ? t('submit.locationRequired') : undefined;

  const onSubmit = form.handleSubmit(async (values) => {
    setDuplicateId(null);
    try {
      const service = await create.mutateAsync({ ...values, photoUploadIds: photos.map((p) => p.id) });
      router.push(`/services/${service.id}?submitted=1`);
    } catch (err) {
      if (hasErrorCode(err, 'SERVICE_DUPLICATE')) {
        const details = isApiError(err) && err.details && typeof err.details === 'object' ? (err.details as { serviceId?: unknown }) : {};
        setDuplicateId(typeof details.serviceId === 'string' ? details.serviceId : null);
        form.setError('root.server', { type: 'server', message: t('submit.duplicate') });
        return;
      }
      if (hasErrorCode(err, 'RATE_LIMITED')) {
        form.setError('root.server', { type: 'server', message: t('submit.rateLimited') });
        return;
      }
      applyApiError(form, err, errorMessage(err));
    }
  });

  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col">
      <PageHeader back="/services" title={t('submit.title')} description={t('submit.description')} />
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-6">
        <Card className="flex flex-col gap-4">
          <FormField label={t('submit.name')} required error={fieldErrorText(errors.name)}>
            <Input {...form.register('name')} maxLength={SERVICE_LIMITS.nameMax} placeholder={t('submit.namePlaceholder')} autoComplete="off" enterKeyHint="next" />
          </FormField>
          <Controller
            control={form.control}
            name="category"
            render={({ field }) => (
              <FormField label={t('submit.category')} required error={fieldErrorText(errors.category)}>
                <CategorySelect value={field.value} onChange={field.onChange} onBlur={field.onBlur} triggerRef={field.ref} placeholder={t('submit.categoryPlaceholder')} />
              </FormField>
            )}
          />
          <FormField label={t('submit.descriptionLabel')} error={fieldErrorText(errors.description)}>
            <Textarea {...form.register('description')} maxLength={SERVICE_LIMITS.descriptionMax} showCount rows={4} placeholder={t('submit.descriptionPlaceholder')} />
          </FormField>
          <FormField label={t('submit.address')} required error={fieldErrorText(errors.address)}>
            <Input {...form.register('address')} maxLength={SERVICE_LIMITS.addressMax} placeholder={t('submit.addressPlaceholder')} autoComplete="street-address" enterKeyHint="next" />
          </FormField>
          <Controller
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormField label={t('submit.phone')} error={errors.phone ? tf('invalidPhone') : undefined}>
                <PhoneInput ref={field.ref} value={field.value ?? ''} onChange={field.onChange} onBlur={field.onBlur} placeholder="+7 (727) ___-__-__" />
              </FormField>
            )}
          />
        </Card>

        <Card className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">
            {t('submit.location')}
            <span aria-hidden="true" className="ms-0.5 text-danger">
              *
            </span>
          </h2>
          <p className="text-sm text-muted-foreground">{t('submit.locationHint')}</p>
          <Controller
            control={form.control}
            name="lat"
            render={() => {
              const lat = form.watch('lat');
              const lng = form.watch('lng');
              const value = typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null;
              return (
                <LocationPicker
                  value={value}
                  invalid={Boolean(locationError)}
                  describedBy={locationError ? locationErrorId : undefined}
                  onChange={(v) => {
                    form.setValue('lat', v.lat, { shouldValidate: form.formState.isSubmitted });
                    form.setValue('lng', v.lng, { shouldValidate: form.formState.isSubmitted });
                  }}
                />
              );
            }}
          />
          {locationError ? (
            <p id={locationErrorId} role="alert" className="text-sm text-danger">
              {locationError}
            </p>
          ) : null}
        </Card>

        <Card className="flex flex-col gap-2">
          <h2 id={hoursLabelId} className="text-base font-semibold">
            {t('submit.hours')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('submit.hoursHint')}</p>
          <Controller
            control={form.control}
            name="hours"
            render={({ field }) => <HoursEditor value={field.value} onChange={field.onChange} errors={hoursErrors} labelId={hoursLabelId} />}
          />
        </Card>

        <Card className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">{t('submit.photos')}</h2>
          <p id={photosHintId} className="text-sm text-muted-foreground">
            {t('submit.photosHint', { max: SERVICE_LIMITS.photosMax })}
          </p>
          <PhotosField value={photos} onChange={setPhotos} onBusyChange={setUploading} describedBy={photosHintId} />
        </Card>

        {errors.root?.server ? (
          <FormError>
            {errors.root.server.message}{' '}
            {duplicateId ? (
              <Link href={`/services/${duplicateId}`} className="font-medium underline underline-offset-4">
                {t('submit.duplicateLink')}
              </Link>
            ) : null}
          </FormError>
        ) : null}
        <Button type="submit" size="lg" loading={form.formState.isSubmitting} disabled={uploading} className="w-full sm:w-auto sm:self-end">
          {t('submit.submit')}
        </Button>
      </form>
    </div>
  );
}

function CategorySelect({
  value,
  onChange,
  onBlur,
  triggerRef,
  placeholder,
  id,
  ...aria
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  onBlur: () => void;
  triggerRef: (el: HTMLButtonElement | null) => void;
  placeholder: string;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  const t = useTranslations('services.categories');
  return (
    <Select value={value ?? ''} onValueChange={onChange}>
      <SelectTrigger ref={triggerRef} id={id} onBlur={onBlur} aria-describedby={aria['aria-describedby']} aria-invalid={aria['aria-invalid']}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {SERVICE_CATEGORIES.map((c) => {
          const Icon = CATEGORY_META[c].icon;
          return (
            <SelectItem key={c} value={c}>
              <span className="inline-flex items-center gap-2">
                <Icon aria-hidden="true" className="size-4" />
                {t(c)}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
