'use client';

import { LIMITS, type OwnVehicleDto } from '@autoc/shared';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { PhotosField, type DraftPhoto } from '@/components/photos-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormError } from '@/components/ui/form-error';
import { useErrorMessage } from '@/hooks/use-error-message';
import type { VehicleBody } from '@/lib/api/endpoints';
import { applyApiError } from '@/lib/forms/apply-api-error';
import { notify } from '@/lib/toast';
import { PremiumLimitHint } from '@/features/premium/limit-hint';
import { useCreateVehicle, useUpdateVehicle } from './queries';
import { EMPTY_VEHICLE, useVehicleForm, VehicleDetailFields, VehicleFields, vehicleDefaults, type VehicleFormOutput } from './vehicle-form';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this vehicle; omit to add a new one. */
  vehicle?: OwnVehicleDto | null;
};

export function VehicleDialog({ open, onOpenChange, vehicle }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="vehicle-dialog">
        {/* Remount per vehicle so the form starts from its values. */}
        {open ? <VehicleDialogBody key={vehicle?.id ?? 'new'} vehicle={vehicle ?? null} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/** The request body: on create, unset details are left out; on edit they are sent as null (clears them). */
export function vehicleBody(values: VehicleFormOutput, photoIds: string[] | undefined, mode: 'create' | 'update'): VehicleBody {
  const body: Record<string, unknown> = { ...values };
  delete body.photoUploadIds;
  if (photoIds !== undefined) body.photoUploadIds = photoIds;
  if (mode === 'create') {
    for (const key of Object.keys(body)) if (body[key] === null || body[key] === undefined) delete body[key];
  } else {
    for (const key of Object.keys(body)) if (body[key] === undefined) delete body[key];
  }
  return body as VehicleBody;
}

function VehicleDialogBody({ vehicle, onDone }: { vehicle: OwnVehicleDto | null; onDone: () => void }) {
  const t = useTranslations('vehicles');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const form = useVehicleForm(vehicle ? vehicleDefaults(vehicle) : EMPTY_VEHICLE);
  const create = useCreateVehicle();
  const update = useUpdateVehicle();
  const initialPhotos = (vehicle?.photos ?? []).map((p) => ({ id: p.id, url: p.thumbUrl ?? p.url }));
  const [photos, setPhotos] = useState<DraftPhoto[]>(initialPhotos);
  const [uploading, setUploading] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const onBusyChange = useCallback((busy: boolean) => setUploading(busy), []);

  const photosChanged = photos.map((p) => p.id).join() !== initialPhotos.map((p) => p.id).join();

  const submit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    const photoIds = vehicle ? (photosChanged ? photos.map((p) => p.id) : undefined) : photos.length ? photos.map((p) => p.id) : undefined;
    try {
      if (vehicle) await update.mutateAsync({ id: vehicle.id, input: vehicleBody(values, photoIds, 'update') });
      else await create.mutateAsync(vehicleBody(values, photoIds, 'create'));
      notify.success(vehicle ? t('updated') : t('added'));
      onDone();
    } catch (error) {
      setSubmitError(error);
      applyApiError(form, error, errorMessage(error));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>{vehicle ? t('editTitle') : t('addTitle')}</DialogTitle>
        <DialogDescription>{t('dialogDescription')}</DialogDescription>
      </DialogHeader>
      <VehicleFields form={form} />
      <section aria-labelledby="vehicle-details-heading" className="flex flex-col gap-3 border-t pt-4">
        <div className="flex flex-col gap-0.5">
          <h3 id="vehicle-details-heading" className="text-base font-semibold">
            {t('detailsTitle')}
          </h3>
          <p className="text-sm text-muted-foreground">{t('detailsHint')}</p>
        </div>
        <VehicleDetailFields form={form} />
      </section>
      <section aria-labelledby="vehicle-photos-heading" className="flex flex-col gap-3 border-t pt-4">
        <div className="flex flex-col gap-0.5">
          <h3 id="vehicle-photos-heading" className="text-base font-semibold">
            {t('photosTitle')}
          </h3>
          <p className="text-sm text-muted-foreground">{t('photosHint', { max: LIMITS.vehiclePhotosMax })}</p>
        </div>
        <PhotosField purpose="vehicle" max={LIMITS.vehiclePhotosMax} value={photos} onChange={setPhotos} onBusyChange={onBusyChange} label={t('photosTitle')} testId="vehicle-photo" />
      </section>
      <FormError>{form.formState.errors.root?.server?.message}</FormError>
      {form.formState.errors.root?.server ? <PremiumLimitHint error={submitError} /> : null}
      <DialogFooter>
        <Button variant="secondary" onClick={onDone} disabled={form.formState.isSubmitting}>
          {tc('cancel')}
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting} disabled={uploading}>
          {vehicle ? tc('save') : t('add')}
        </Button>
      </DialogFooter>
    </form>
  );
}
