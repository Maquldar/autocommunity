'use client';

import type { Me, VehicleDto } from '@autoc/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bell, MapPin, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useReducer, useRef, useState, type Dispatch, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Skeleton } from '@/components/ui/skeleton';
import { AvatarPicker } from '@/features/profile/avatar-picker';
import { ProfileFields, profileDefaults, useProfileForm } from '@/features/profile/profile-form';
import { useCreateVehicle, useMyVehicles, useUpdateMe, useUpdateVehicle } from '@/features/profile/queries';
import { EMPTY_VEHICLE, useVehicleForm, VehicleFields, vehicleDefaults } from '@/features/profile/vehicle-form';
import { PrivacyModePicker } from '@/features/settings/privacy-mode-picker';
import { ReceiveSosRow } from '@/features/settings/receive-sos-row';
import { useErrorMessage } from '@/hooks/use-error-message';
import { api } from '@/lib/api';
import { hasErrorCode } from '@/lib/api/errors';
import { ME_QUERY_KEY } from '@/lib/auth/auth-provider';
import { useCurrentUser } from '@/lib/auth/guards';
import { applyApiError } from '@/lib/forms/apply-api-error';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import {
  ONBOARDING_STEPS,
  onboardingReducer,
  stepIndex,
  type OnboardingAction,
  type OnboardingState,
} from './onboarding-state';

export function initialOnboardingState(me: Me, vehicles: VehicleDto[]): OnboardingState {
  // Resuming after a reload: start from what is already saved.
  const vehicle = vehicles.find((v) => v.isPrimary) ?? vehicles[0] ?? null;
  return {
    step: 'profile',
    profile: profileDefaults(me),
    avatar: { url: me.avatarUrl },
    car: vehicle ? vehicleDefaults(vehicle) : EMPTY_VEHICLE,
    vehicleId: vehicle?.id ?? null,
    carSkipped: false,
    privacy: { privacyMode: me.privacyMode, receiveSos: me.receiveSos, consent: false },
  };
}

export function OnboardingView() {
  const t = useTranslations('onboarding');
  const me = useCurrentUser();
  const vehicles = useMyVehicles();

  if (vehicles.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-11 w-full rounded-lg" />
        <Skeleton className="h-11 w-full rounded-lg" />
      </div>
    );
  }
  // A failed vehicles lookup only loses the prefill; onboarding still works.
  return <OnboardingFlow initial={initialOnboardingState(me, vehicles.data ?? [])} />;
}

function OnboardingFlow({ initial }: { initial: OnboardingState }) {
  const t = useTranslations('onboarding');
  const [state, dispatch] = useReducer(onboardingReducer, initial);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const index = stepIndex(state.step);

  // Move focus to the new step's heading so screen readers announce it.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
    window.scrollTo({ top: 0 });
  }, [state.step]);

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t('progressLabel')} className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">{t('stepOf', { step: index + 1, total: ONBOARDING_STEPS.length })}</p>
        <ol className="grid grid-cols-3 gap-2">
          {ONBOARDING_STEPS.map((step, i) => (
            <li key={step} aria-current={i === index ? 'step' : undefined} className="flex flex-col gap-1.5">
              <span className={cn('h-1.5 rounded-full transition-colors duration-base', i <= index ? 'bg-primary' : 'bg-muted')} />
              <span className={cn('text-xs', i === index ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                <span className="sr-only">{i < index ? t('stepDone') : null}</span>
                {t(`steps.${step}`)}
              </span>
            </li>
          ))}
        </ol>
      </nav>

      <header className="flex flex-col gap-2">
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold leading-8 tracking-tight text-balance outline-none">
          {t(`${state.step}.title`)}
        </h1>
        <p className="text-[0.9375rem] text-muted-foreground text-pretty">{t(`${state.step}.description`)}</p>
      </header>

      {state.step === 'profile' ? <ProfileStep state={state} dispatch={dispatch} /> : null}
      {state.step === 'car' ? <CarStep state={state} dispatch={dispatch} /> : null}
      {state.step === 'privacy' ? <PrivacyStep state={state} dispatch={dispatch} /> : null}
    </div>
  );
}

type StepProps = { state: OnboardingState; dispatch: Dispatch<OnboardingAction> };

/** Back (secondary) + Next (primary): stacked on phones with the primary on top, inline from 640px. */
function StepActions({ onBack, back, children }: { onBack?: () => void; back?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
      {onBack ? (
        <Button variant="ghost" size="lg" onClick={onBack} leadingIcon={<ArrowLeft aria-hidden="true" className="rtl:rotate-180" />}>
          {back}
        </Button>
      ) : (
        <span />
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row">{children}</div>
    </div>
  );
}

function ProfileStep({ state, dispatch }: StepProps) {
  const t = useTranslations('onboarding');
  const me = useCurrentUser();
  const errorMessage = useErrorMessage();
  const form = useProfileForm(state.profile);
  const updateMe = useUpdateMe();
  const [avatar, setAvatar] = useState(state.avatar);
  const [uploading, setUploading] = useState(false);
  const name = form.watch('name');

  const submit = form.handleSubmit(async (values) => {
    try {
      await updateMe.mutateAsync({
        name: values.name,
        nickname: values.nickname,
        city: values.city,
        ...(avatar.uploadId !== undefined ? { avatarUploadId: avatar.uploadId } : {}),
      });
      // The avatar is saved now; later edits on this step start from "unchanged".
      dispatch({ type: 'profileSaved', profile: form.getValues(), avatar: { url: avatar.url } });
    } catch (error) {
      applyApiError(form, error, errorMessage(error), { fieldByCode: { NICKNAME_TAKEN: 'nickname' } });
    }
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <AvatarPicker userId={me.id} name={name} value={avatar} onChange={setAvatar} onBusyChange={setUploading} />
      <ProfileFields form={form} />
      <FormError>{form.formState.errors.root?.server?.message}</FormError>
      <StepActions>
        <Button type="submit" size="lg" fullWidth className="sm:w-auto" loading={form.formState.isSubmitting} disabled={uploading}>
          {t('next')}
        </Button>
      </StepActions>
    </form>
  );
}

function CarStep({ state, dispatch }: StepProps) {
  const t = useTranslations('onboarding');
  const errorMessage = useErrorMessage();
  const form = useVehicleForm(state.car);
  const create = useCreateVehicle();
  const update = useUpdateVehicle();

  const submit = form.handleSubmit(async (values) => {
    try {
      const vehicle = state.vehicleId
        ? await update.mutateAsync({ id: state.vehicleId, input: values })
        : await create.mutateAsync(values);
      dispatch({ type: 'carSaved', car: form.getValues(), vehicleId: vehicle.id });
    } catch (error) {
      applyApiError(form, error, errorMessage(error));
    }
  });

  const busy = form.formState.isSubmitting;
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <VehicleFields form={form} />
      <FormError>{form.formState.errors.root?.server?.message}</FormError>
      <StepActions onBack={() => dispatch({ type: 'back', draft: { car: form.getValues() } })} back={t('back')}>
        <Button
          variant="secondary"
          size="lg"
          disabled={busy}
          onClick={() => dispatch({ type: 'carSkipped', car: form.getValues() })}
        >
          {t('car.skip')}
        </Button>
        <Button type="submit" size="lg" loading={busy}>
          {t('next')}
        </Button>
      </StepActions>
    </form>
  );
}

function PrivacyStep({ state, dispatch }: StepProps) {
  const t = useTranslations('onboarding');
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consentError, setConsentError] = useState(false);
  const consentRef = useRef<HTMLInputElement>(null);
  const { privacy } = state;

  async function finish(event: FormEvent) {
    event.preventDefault();
    if (!privacy.consent) {
      setConsentError(true);
      consentRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.me.updateSettings({ privacyMode: privacy.privacyMode, receiveSos: privacy.receiveSos });
      const me = await api.me.completeOnboarding();
      notify.success(t('done'));
      // The onboarding guard sees onboardingCompleted and moves on to the app.
      queryClient.setQueryData(ME_QUERY_KEY, me);
    } catch (err) {
      setSubmitting(false);
      if (hasErrorCode(err, 'ONBOARDING_INCOMPLETE')) {
        notify.error(errorMessage(err));
        dispatch({ type: 'back' });
        dispatch({ type: 'back' });
        return;
      }
      setError(errorMessage(err));
    }
  }

  const reasons = [
    { icon: MapPin, text: t('privacy.reasonMap') },
    { icon: Bell, text: t('privacy.reasonSos') },
    { icon: ShieldCheck, text: t('privacy.reasonStorage') },
  ];

  return (
    <form onSubmit={finish} noValidate className="flex flex-col gap-6">
      <ul className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-5">
        {reasons.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-3 text-[0.9375rem]">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
              <Icon aria-hidden="true" className="size-4" />
            </span>
            <span className="pt-1">{text}</span>
          </li>
        ))}
      </ul>

      <section className="flex flex-col gap-3" aria-labelledby="onboarding-privacy-label">
        <h2 id="onboarding-privacy-label" className="text-lg font-semibold">
          {t('privacy.modeLabel')}
        </h2>
        <PrivacyModePicker
          value={privacy.privacyMode}
          onChange={(privacyMode) => dispatch({ type: 'privacyChanged', privacy: { privacyMode } })}
          labelledBy="onboarding-privacy-label"
          disabled={submitting}
        />
        <ReceiveSosRow
          checked={privacy.receiveSos}
          onCheckedChange={(receiveSos) => dispatch({ type: 'privacyChanged', privacy: { receiveSos } })}
          disabled={submitting}
        />
      </section>

      <div className="flex flex-col gap-1.5">
        <label className="flex cursor-pointer items-start gap-3 text-[0.9375rem]">
          <input
            ref={consentRef}
            type="checkbox"
            checked={privacy.consent}
            onChange={(event) => {
              setConsentError(false);
              dispatch({ type: 'privacyChanged', privacy: { consent: event.target.checked } });
            }}
            aria-invalid={consentError || undefined}
            aria-describedby={consentError ? 'consent-error' : undefined}
            className="mt-0.5 size-5 shrink-0 cursor-pointer rounded accent-primary focus-ring"
          />
          <span>
            {t.rich('privacy.consent', {
              link: (chunks) => (
                <Link href="/legal/privacy" target="_blank" className="font-medium text-primary underline-offset-4 hover:underline focus-ring rounded-sm">
                  {chunks}
                </Link>
              ),
            })}
          </span>
        </label>
        {consentError ? (
          <p id="consent-error" className="text-sm text-danger">
            {t('privacy.consentRequired')}
          </p>
        ) : null}
      </div>

      <FormError>{error}</FormError>
      <StepActions onBack={() => dispatch({ type: 'back' })} back={t('back')}>
        <Button type="submit" size="lg" loading={submitting}>
          {t('privacy.finish')}
        </Button>
      </StepActions>
    </form>
  );
}
