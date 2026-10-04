'use client';

import { otpRequestSchema } from '@autoc/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { FormField } from '@/components/ui/form-field';
import { PhoneInput } from '@/components/ui/phone-input';
import { useCountdown } from '@/hooks/use-countdown';
import { useErrorMessage } from '@/hooks/use-error-message';
import { getRetryAfterSec, hasErrorCode } from '@/lib/api/errors';
import { applyApiError } from '@/lib/forms/apply-api-error';
import { fieldErrorText } from '@/lib/forms/field-error';
import { useZodErrorMap } from '@/lib/forms/zod-error-map';
import { isCompleteKzPhone } from '@/lib/phone-mask';

// The shared schema accepts any E.164 number; the UI is Kazakhstan-only (+7 7XX).
const phoneFormSchema = otpRequestSchema.refine((value) => isCompleteKzPhone(value.phone), { path: ['phone'] });

type Props = {
  defaultPhone: string;
  onSubmit: (phone: string) => Promise<void>;
  submitLabel: string;
  autoFocus?: boolean;
};

export function PhoneStep({ defaultPhone, onSubmit, submitLabel, autoFocus = true }: Props) {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const form = useForm({
    resolver: zodResolver(phoneFormSchema, { error: useZodErrorMap() }),
    defaultValues: { phone: defaultPhone },
  });
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const cooldown = useCountdown(cooldownUntil);
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async ({ phone }) => {
    try {
      await onSubmit(phone);
    } catch (error) {
      const retryAfter = hasErrorCode(error, 'RATE_LIMITED') ? getRetryAfterSec(error) : null;
      if (retryAfter) {
        setCooldownUntil(Date.now() + retryAfter * 1000);
        return;
      }
      applyApiError(form, error, errorMessage(error), { fieldByCode: { PHONE_IN_USE: 'phone', PHONE_NOT_SUPPORTED: 'phone' } });
    }
  });

  const invalidPhone = t('form.invalidPhone');
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Controller
        name="phone"
        control={form.control}
        render={({ field, fieldState }) => (
          <FormField
            label={t('phone.label')}
            hint={t('phone.hint')}
            required
            error={fieldErrorText(fieldState.error, {
              custom: invalidPhone,
              too_small: invalidPhone,
              too_big: invalidPhone,
            })}
          >
            <PhoneInput
              ref={field.ref}
              name={field.name}
              value={field.value}
              onChange={(value) => {
                field.onChange(value);
                if (errors.root) form.clearErrors('root');
              }}
              onBlur={field.onBlur}
              autoFocus={autoFocus}
              enterKeyHint="send"
            />
          </FormField>
        )}
      />
      <FormError>{cooldown > 0 ? t('errors.rateLimited', { seconds: cooldown }) : errors.root?.server?.message}</FormError>
      <Button type="submit" size="lg" fullWidth loading={isSubmitting} disabled={cooldown > 0}>
        {submitLabel}
      </Button>
    </form>
  );
}
