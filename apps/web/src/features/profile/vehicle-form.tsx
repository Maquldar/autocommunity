'use client';

import { CAR_BRANDS, LIMITS, vehicleSchema, type VehicleDto } from '@autoc/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { fieldErrorText } from '@/lib/forms/field-error';
import { useZodErrorMap } from '@/lib/forms/zod-error-map';

const vehicleFormSchema = vehicleSchema.omit({ isPrimary: true });

export type VehicleFormInput = z.input<typeof vehicleFormSchema>;
export type VehicleFormOutput = z.output<typeof vehicleFormSchema>;
export type VehicleForm = UseFormReturn<VehicleFormInput, unknown, VehicleFormOutput>;

export const EMPTY_VEHICLE: VehicleFormInput = { brand: '', model: '', year: '', plate: '' };

export function vehicleDefaults(vehicle: Pick<VehicleDto, 'brand' | 'model' | 'year' | 'plate'>): VehicleFormInput {
  return { brand: vehicle.brand, model: vehicle.model, year: String(vehicle.year), plate: vehicle.plate ?? '' };
}

const BRANDS = Object.keys(CAR_BRANDS).sort((a, b) => a.localeCompare(b));

/** Popular models for a brand typed in any case ("toyota" → Toyota's list). */
export function modelSuggestions(brand: string): readonly string[] {
  const key = BRANDS.find((b) => b.toLowerCase() === brand.trim().toLowerCase());
  return key ? (CAR_BRANDS[key] ?? []) : [];
}

export function useVehicleForm(defaultValues: VehicleFormInput = EMPTY_VEHICLE): VehicleForm {
  return useForm({
    resolver: zodResolver(vehicleFormSchema, { error: useZodErrorMap() }),
    defaultValues,
    mode: 'onTouched',
  });
}

/**
 * Brand (suggestions from CAR_BRANDS, free text allowed), model (suggestions for the brand), year
 * and optional plate. Shared by onboarding step 2 and the add/edit vehicle dialog.
 */
export function VehicleFields({ form }: { form: VehicleForm }) {
  const t = useTranslations('vehicles.fields');
  const brandListId = useId();
  const modelListId = useId();
  const brand = useWatch({ control: form.control, name: 'brand' });
  const models = modelSuggestions(brand);
  const { errors } = form.formState;
  const maxYear = new Date().getFullYear() + 1;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormField label={t('brand')} required hint={t('brandHint')} error={fieldErrorText(errors.brand)}>
        <Input
          {...form.register('brand')}
          list={brandListId}
          autoComplete="off"
          placeholder={t('brandPlaceholder')}
          maxLength={LIMITS.vehicleTextMax}
          enterKeyHint="next"
        />
      </FormField>
      <datalist id={brandListId}>
        {BRANDS.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>

      <FormField label={t('model')} required error={fieldErrorText(errors.model)}>
        <Input
          {...form.register('model')}
          list={models.length ? modelListId : undefined}
          autoComplete="off"
          placeholder={models[0] ?? t('modelPlaceholder')}
          maxLength={LIMITS.vehicleTextMax}
          enterKeyHint="next"
        />
      </FormField>
      <datalist id={modelListId}>
        {models.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>

      <FormField
        label={t('year')}
        required
        error={fieldErrorText(errors.year, {
          custom: t('yearRange', { min: LIMITS.minVehicleYear, max: maxYear }),
          too_small: t('yearRange', { min: LIMITS.minVehicleYear, max: maxYear }),
          invalid_type: t('yearRange', { min: LIMITS.minVehicleYear, max: maxYear }),
        })}
      >
        <Input {...form.register('year')} inputMode="numeric" autoComplete="off" maxLength={4} placeholder="2019" enterKeyHint="next" />
      </FormField>

      <FormField
        label={t('plate')}
        hint={t('plateHint')}
        error={fieldErrorText(errors.plate, { invalid_format: t('plateFormat') })}
      >
        <Input
          {...form.register('plate', { setValueAs: (value: string | null) => (value ?? '').toUpperCase() })}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder="123ABC02"
          maxLength={LIMITS.plateMax}
          className="uppercase"
        />
      </FormField>
    </div>
  );
}
