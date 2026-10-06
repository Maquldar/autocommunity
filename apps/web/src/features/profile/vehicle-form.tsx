'use client';

import {
  CAR_BRANDS,
  LIMITS,
  VEHICLE_BODY_TYPES,
  VEHICLE_COLORS,
  VEHICLE_DRIVES,
  VEHICLE_FUELS,
  VEHICLE_TRANSMISSIONS,
  vehicleSchema,
  type OwnVehicleDto,
  type VehicleDto,
} from '@autoc/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { Controller, useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { fieldErrorText } from '@/lib/forms/field-error';
import { useZodErrorMap } from '@/lib/forms/zod-error-map';

const vehicleFormSchema = vehicleSchema.omit({ isPrimary: true });

export type VehicleFormInput = z.input<typeof vehicleFormSchema>;
export type VehicleFormOutput = z.output<typeof vehicleFormSchema>;
export type VehicleForm = UseFormReturn<VehicleFormInput, unknown, VehicleFormOutput>;

export const EMPTY_VEHICLE: VehicleFormInput = { brand: '', model: '', year: '', plate: '' };

type DetailSource = Partial<Pick<OwnVehicleDto, 'vin' | 'engineVolumeL' | 'fuel' | 'transmission' | 'drive' | 'bodyType' | 'color' | 'mileageKm' | 'description'>>;

export function vehicleDefaults(vehicle: Pick<VehicleDto, 'brand' | 'model' | 'year' | 'plate'> & DetailSource): VehicleFormInput {
  return {
    brand: vehicle.brand,
    model: vehicle.model,
    year: String(vehicle.year),
    plate: vehicle.plate ?? '',
    vin: vehicle.vin ?? null,
    engineVolumeL: vehicle.engineVolumeL ?? null,
    fuel: vehicle.fuel ?? null,
    transmission: vehicle.transmission ?? null,
    drive: vehicle.drive ?? null,
    bodyType: vehicle.bodyType ?? null,
    // Older API builds don't send `color` yet.
    color: vehicle.color ?? null,
    mileageKm: vehicle.mileageKm ?? null,
    description: vehicle.description ?? '',
  };
}

/** VIN rule of the contract (17 chars, no I/O/Q), as a pure check for hints and tests. */
export function vinProblem(raw: string): 'length' | 'letters' | null {
  const vin = raw.trim().toUpperCase();
  if (!vin) return null;
  if (/[IOQ]/.test(vin)) return 'letters';
  if (vin.length !== 17 || !/^[A-HJ-NPR-Z0-9]+$/.test(vin)) return 'length';
  return null;
}

/** Empty inputs mean "not set" (null), so optional numbers and the VIN never fail on ''. */
export const emptyToNull = (value: unknown) => (value === '' || value === undefined ? null : value);

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

const NOT_SET = '__none';

type EnumField = 'fuel' | 'transmission' | 'drive' | 'bodyType' | 'color';
const ENUM_OPTIONS: Record<EnumField, readonly string[]> = {
  fuel: VEHICLE_FUELS,
  transmission: VEHICLE_TRANSMISSIONS,
  drive: VEHICLE_DRIVES,
  bodyType: VEHICLE_BODY_TYPES,
  color: VEHICLE_COLORS,
};

type SlotProps = { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean | 'true' | 'false' };

/** Receives FormField's id/aria wiring (through Slot) and forwards it to the Select trigger. */
function EnumSelectControl({
  name,
  value,
  onChange,
  onBlur,
  ...aria
}: SlotProps & { name: EnumField; value: string | null | undefined; onChange: (v: string | null) => void; onBlur: () => void }) {
  const t = useTranslations('vehicles');
  return (
    <Select value={value ?? NOT_SET} onValueChange={(v) => onChange(v === NOT_SET ? null : v)}>
      <SelectTrigger id={aria.id} aria-describedby={aria['aria-describedby']} aria-invalid={aria['aria-invalid']} onBlur={onBlur} data-testid={`vehicle-${name}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NOT_SET}>{t('fields.notSet')}</SelectItem>
        {ENUM_OPTIONS[name].map((option) => (
          <SelectItem key={option} value={option}>
            {t(`enums.${name}.${option}` as 'enums.fuel.petrol')}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function EnumSelect({ form, name }: { form: VehicleForm; name: EnumField }) {
  const t = useTranslations('vehicles');
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormField label={t(`fields.${name}`)}>
          <EnumSelectControl name={name} value={field.value as string | null | undefined} onChange={field.onChange} onBlur={field.onBlur} />
        </FormField>
      )}
    />
  );
}

/**
 * Phase 9 details (all optional): VIN (owner only — this form is only ever the owner's), engine volume, fuel,
 * transmission, drive, body type, colour, mileage and a description. Photos are a separate field.
 */
export function VehicleDetailFields({ form }: { form: VehicleForm }) {
  const t = useTranslations('vehicles.fields');
  const { errors } = form.formState;
  const vinValue = useWatch({ control: form.control, name: 'vin' });
  const vinHint = vinProblem(String(vinValue ?? ''));

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormField
        label={t('vin')}
        hint={t('vinHint')}
        className="sm:col-span-2"
        error={fieldErrorText(errors.vin, { invalid_format: vinHint === 'letters' ? t('vinLetters') : t('vinFormat'), too_small: t('vinFormat'), too_big: t('vinFormat') })}
      >
        <Input
          {...form.register('vin', { setValueAs: (v: string | null) => (v ? String(v).trim().toUpperCase() : null) })}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={17}
          placeholder="JTDBR32E720123456"
          className="uppercase tabular-nums"
          data-testid="vehicle-vin"
        />
      </FormField>
      <FormField
        label={t('engineVolume')}
        hint={t('engineVolumeHint')}
        error={fieldErrorText(errors.engineVolumeL, {
          too_small: t('engineRange', { min: LIMITS.engineVolumeMinL, max: LIMITS.engineVolumeMaxL }),
          too_big: t('engineRange', { min: LIMITS.engineVolumeMinL, max: LIMITS.engineVolumeMaxL }),
          invalid_type: t('engineRange', { min: LIMITS.engineVolumeMinL, max: LIMITS.engineVolumeMaxL }),
        })}
      >
        <Input
          {...form.register('engineVolumeL', { setValueAs: (v: unknown) => emptyToNull(typeof v === 'string' ? v.replace(',', '.').trim() : v) })}
          inputMode="decimal"
          autoComplete="off"
          placeholder="2.5"
          data-testid="vehicle-engine"
        />
      </FormField>
      <FormField
        label={t('mileage')}
        hint={t('mileageHint')}
        error={fieldErrorText(errors.mileageKm, {
          too_small: t('mileageRange', { max: LIMITS.mileageMaxKm }),
          too_big: t('mileageRange', { max: LIMITS.mileageMaxKm }),
          invalid_type: t('mileageRange', { max: LIMITS.mileageMaxKm }),
        })}
      >
        <Input
          {...form.register('mileageKm', { setValueAs: (v: unknown) => emptyToNull(typeof v === 'string' ? v.replace(/[\s ]/g, '') : v) })}
          inputMode="numeric"
          autoComplete="off"
          placeholder="85000"
          data-testid="vehicle-mileage"
        />
      </FormField>
      <EnumSelect form={form} name="fuel" />
      <EnumSelect form={form} name="transmission" />
      <EnumSelect form={form} name="drive" />
      <EnumSelect form={form} name="bodyType" />
      <EnumSelect form={form} name="color" />
      <Controller
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormField label={t('description')} hint={t('descriptionHint')} className="sm:col-span-2" error={fieldErrorText(errors.description)}>
            <Textarea
              ref={field.ref}
              name={field.name}
              value={(field.value as string | null | undefined) ?? ''}
              onChange={(e) => field.onChange(e.target.value)}
              onBlur={field.onBlur}
              maxLength={LIMITS.vehicleDescriptionMax}
              showCount
              rows={3}
              data-testid="vehicle-description"
            />
          </FormField>
        )}
      />
    </div>
  );
}
