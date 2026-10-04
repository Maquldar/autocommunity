'use client';

import type { VehicleDto } from '@autoc/shared';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormError } from '@/components/ui/form-error';
import { useErrorMessage } from '@/hooks/use-error-message';
import { applyApiError } from '@/lib/forms/apply-api-error';
import { notify } from '@/lib/toast';
import { useCreateVehicle, useUpdateVehicle } from './queries';
import { EMPTY_VEHICLE, useVehicleForm, VehicleFields, vehicleDefaults } from './vehicle-form';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this vehicle; omit to add a new one. */
  vehicle?: VehicleDto | null;
};

export function VehicleDialog({ open, onOpenChange, vehicle }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {/* Remount per vehicle so the form starts from its values. */}
        {open ? <VehicleDialogBody key={vehicle?.id ?? 'new'} vehicle={vehicle ?? null} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function VehicleDialogBody({ vehicle, onDone }: { vehicle: VehicleDto | null; onDone: () => void }) {
  const t = useTranslations('vehicles');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const form = useVehicleForm(vehicle ? vehicleDefaults(vehicle) : EMPTY_VEHICLE);
  const create = useCreateVehicle();
  const update = useUpdateVehicle();

  const submit = form.handleSubmit(async (values) => {
    try {
      if (vehicle) await update.mutateAsync({ id: vehicle.id, input: values });
      else await create.mutateAsync(values);
      notify.success(vehicle ? t('updated') : t('added'));
      onDone();
    } catch (error) {
      applyApiError(form, error, errorMessage(error));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{vehicle ? t('editTitle') : t('addTitle')}</DialogTitle>
        <DialogDescription>{t('dialogDescription')}</DialogDescription>
      </DialogHeader>
      <VehicleFields form={form} />
      <FormError>{form.formState.errors.root?.server?.message}</FormError>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone} disabled={form.formState.isSubmitting}>
          {tc('cancel')}
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          {vehicle ? tc('save') : t('add')}
        </Button>
      </DialogFooter>
    </form>
  );
}
