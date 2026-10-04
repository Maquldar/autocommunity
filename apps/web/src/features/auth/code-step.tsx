'use client';

import { otpVerifySchema } from '@autoc/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { FlaskConical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { FormField } from '@/components/ui/form-field';
import { OtpInput } from '@/components/ui/otp-input';
import { useCountdown } from '@/hooks/use-countdown';
import { useErrorMessage } from '@/hooks/use-error-message';
import { getRetryAfterSec, hasErrorCode } from '@/lib/api/errors';
import { applyApiError } from '@/lib/forms/apply-api-error';
import { fieldErrorText } from '@/lib/forms/field-error';
import { useZodErrorMap } from '@/lib/forms/zod-error-map';
import { formatKzPhone, fromE164 } from '@/lib/phone-mask';
import { notify } from '@/lib/toast';
import { formatCountdown } from './use-otp-flow';

const codeFormSchema = otpVerifySchema.pick({ code: true });

type Props = {
  phone: string;
  /** Code returned by the API in demo deployments without SMS (`devCode`). */
  devCode: string | null;
  resendAt: number;
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<void>;
  onChangeNumber: () => void;
  submitLabel: string;
};

export function CodeStep({ phone, devCode, resendAt, onVerify, onResend, onChangeNumber, submitLabel }: Props) {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const form = useForm({
    resolver: zodResolver(codeFormSchema, { error: useZodErrorMap() }),
    defaultValues: { code: '' },
  });
  const [resendDeadline, setResendDeadline] = useState<number | null>(null);
  const resendIn = useCountdown(resendDeadline ?? resendAt);
  const [resending, setResending] = useState(false);
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async ({ code }) => {
    try {
      await onVerify(code);
    } catch (error) {
      // A wrong or burned code can't be fixed by editing it: clear the boxes for a fresh attempt.
      if (hasErrorCode(error, 'OTP_INVALID') || hasErrorCode(error, 'OTP_EXPIRED')) form.setValue('code', '');
      applyApiError(form, error, errorMessage(error), {
        fieldByCode: { OTP_INVALID: 'code', OTP_EXPIRED: 'code', RATE_LIMITED: 'code' },
      });
    }
  });

  async function resend() {
    setResending(true);
    form.clearErrors();
    try {
      await onResend();
      setResendDeadline(null);
      form.setValue('code', '');
      notify.success(t('auth.codeResent'));
    } catch (error) {
      const retryAfter = hasErrorCode(error, 'RATE_LIMITED') ? getRetryAfterSec(error) : null;
      if (retryAfter) setResendDeadline(Date.now() + retryAfter * 1000);
      form.setError('root.server', { type: 'server', message: errorMessage(error) });
    } finally {
      setResending(false);
    }
  }

  const busy = isSubmitting || resending;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[0.9375rem] text-muted-foreground">
        {t.rich('auth.codeSentTo', {
          phone: () => (
            <span className="whitespace-nowrap font-medium tabular-nums text-foreground">{formatKzPhone(fromE164(phone))}</span>
          ),
        })}{' '}
        <Button variant="link" onClick={onChangeNumber} disabled={busy} className="align-baseline">
          {t('auth.changeNumber')}
        </Button>
      </p>

      {devCode ? (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed border-warning bg-warning-soft p-3.5 text-warning-soft-foreground">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <FlaskConical aria-hidden="true" className="size-4 shrink-0" />
            {t('auth.devCode.title')}
          </p>
          <p className="text-sm">{t('auth.devCode.description')}</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm">
              {t('auth.devCode.label')}{' '}
              <output data-testid="dev-code" className="font-mono text-lg font-bold tracking-[0.2em] tabular-nums">
                {devCode}
              </output>
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                form.setValue('code', devCode);
                void submit();
              }}
            >
              {t('auth.devCode.use')}
            </Button>
          </div>
        </div>
      ) : null}

      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Controller
          name="code"
          control={form.control}
          render={({ field, fieldState }) => (
            <FormField
              label={t('otp.label')}
              error={fieldErrorText(fieldState.error, {
                invalid_format: t('form.invalidCode'),
                custom: t('form.invalidCode'),
              })}
            >
              <OtpInput
                value={field.value}
                onChange={(value) => {
                  field.onChange(value);
                  if (fieldState.error) form.clearErrors('code');
                }}
                onComplete={(code) => {
                  form.setValue('code', code);
                  void submit();
                }}
                disabled={resending}
                autoFocus
              />
            </FormField>
          )}
        />
        <FormError>{errors.root?.server?.message}</FormError>
        <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
          {submitLabel}
        </Button>
      </form>

      <div className="flex flex-col items-center gap-1 text-sm text-muted-foreground" aria-live="polite">
        {resendIn > 0 ? (
          <p className="tabular-nums">{t('auth.resendIn', { time: formatCountdown(resendIn) })}</p>
        ) : (
          <Button variant="ghost" size="sm" onClick={resend} loading={resending} disabled={isSubmitting}>
            {t('auth.resend')}
          </Button>
        )}
      </div>
    </div>
  );
}
