'use client';

import { CITIES, LIMITS, updateMeSchema, type Me } from '@autoc/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import type { Ref } from 'react';
import { Controller, useForm, type UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { fieldErrorText } from '@/lib/forms/field-error';
import { useZodErrorMap } from '@/lib/forms/zod-error-map';
import { useCityName } from './city';

/** PATCH /me fields edited by onboarding and /profile/edit; name and nickname are required there. */
export const profileFormSchema = updateMeSchema
  .pick({ name: true, nickname: true, city: true, bio: true })
  .required({ name: true, nickname: true });

export type ProfileFormInput = z.input<typeof profileFormSchema>;
export type ProfileFormOutput = z.output<typeof profileFormSchema>;
export type ProfileForm = UseFormReturn<ProfileFormInput, unknown, ProfileFormOutput>;

const NO_CITY = 'none';

export function profileDefaults(me: Pick<Me, 'name' | 'nickname' | 'city' | 'bio'>): ProfileFormInput {
  const city = CITIES.find((c) => c === me.city) ?? null;
  return { name: me.name, nickname: me.nickname ?? '', city, bio: me.bio ?? '' };
}

export function useProfileForm(defaultValues: ProfileFormInput): ProfileForm {
  return useForm({
    resolver: zodResolver(profileFormSchema, { error: useZodErrorMap() }),
    defaultValues,
    mode: 'onTouched',
  });
}

/** Name, nickname, city and (optionally) bio. Shared by onboarding step 1 and /profile/edit. */
export function ProfileFields({ form, showBio = false }: { form: ProfileForm; showBio?: boolean }) {
  const t = useTranslations('profile.fields');
  const { errors } = form.formState;

  return (
    <div className="flex flex-col gap-4">
      <FormField label={t('name')} required error={fieldErrorText(errors.name)}>
        <Input {...form.register('name')} autoComplete="name" maxLength={LIMITS.nameMax} enterKeyHint="next" />
      </FormField>

      <FormField
        label={t('nickname')}
        required
        hint={t('nicknameHint', { min: LIMITS.nicknameMin, max: LIMITS.nicknameMax })}
        error={fieldErrorText(errors.nickname, { invalid_format: t('nicknameFormat') })}
      >
        <Input
          {...form.register('nickname', {
            setValueAs: (value: string) => value.toLowerCase(),
          })}
          placeholder={t('nicknamePlaceholder')}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
          spellCheck={false}
          maxLength={LIMITS.nicknameMax}
          enterKeyHint="next"
        />
      </FormField>

      <Controller
        name="city"
        control={form.control}
        render={({ field, fieldState }) => (
          <FormField label={t('city')} error={fieldErrorText(fieldState.error)}>
            <CitySelect value={field.value ?? null} onChange={field.onChange} onBlur={field.onBlur} triggerRef={field.ref} />
          </FormField>
        )}
      />

      {showBio ? (
        <Controller
          name="bio"
          control={form.control}
          render={({ field, fieldState }) => (
            <FormField label={t('bio')} error={fieldErrorText(fieldState.error)}>
              <Textarea
                ref={field.ref}
                name={field.name}
                value={field.value ?? ''}
                onChange={field.onChange}
                onBlur={field.onBlur}
                placeholder={t('bioPlaceholder')}
                maxLength={LIMITS.bioMax}
                showCount
              />
            </FormField>
          )}
        />
      ) : null}
    </div>
  );
}

type CitySelectProps = {
  value: string | null;
  onChange: (city: string | null) => void;
  onBlur: () => void;
  triggerRef: Ref<HTMLButtonElement>;
  // Injected by FormField; Radix Select's root renders no element, so they go on the trigger.
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
};

export function CitySelect({ value, onChange, onBlur, triggerRef, id, ...aria }: CitySelectProps) {
  const t = useTranslations('profile.fields');
  const cityName = useCityName();
  return (
    <Select value={value ?? NO_CITY} onValueChange={(next) => onChange(next === NO_CITY ? null : next)}>
      <SelectTrigger ref={triggerRef} id={id} onBlur={onBlur} aria-describedby={aria['aria-describedby']} aria-invalid={aria['aria-invalid']}>
        <SelectValue placeholder={t('cityPlaceholder')} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_CITY}>{t('cityNone')}</SelectItem>
        {CITIES.map((city) => (
          <SelectItem key={city} value={city}>
            {cityName(city)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
