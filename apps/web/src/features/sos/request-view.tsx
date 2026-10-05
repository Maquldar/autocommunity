'use client';

import { RATING, SOS_LIMITS, SOS_TYPES, type SosDto, type SosType } from '@autoc/shared';
import type { Map as MlMap } from 'maplibre-gl';
import { ArrowLeft, Crosshair, HandHelping, LocateFixed, MapPin, Phone, PhoneOff, Siren } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { GeoError } from '@/components/services/errors';
import { getCurrentPosition } from '@/components/services/use-position';
import { Button } from '@/components/ui/button';
import { EmergencyCallButton } from '@/components/ui/emergency-call-button';
import { FormField } from '@/components/ui/form-field';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { ApiError } from '@/lib/api/errors';
import { useCurrentUser } from '@/lib/auth/guards';
import { cn } from '@/lib/cn';
import { useLocationSharing } from '@/lib/location/location-provider';
import { notify } from '@/lib/toast';
import { sosApi, useActiveSos, useCreateSos } from './api';
import { SosEmergencyFooter, SosGuidanceNotice } from './parts';
import { SosPhotosField, type SosPhoto } from './photos-field';
import { SosMap, type LatLng } from './sos-map';
import { SOS_TYPE_ICONS, SosTypeTile } from './sos-type';

type Step = 'type' | 'details' | 'confirm';
const STEPS: Step[] = ['type', 'details', 'confirm'];
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * /sos — the centre nav button. With an open SOS of my own it goes straight to its live page;
 * otherwise it starts "Request help" (SPEC flow 4).
 */
export function SosEntryView() {
  const router = useRouter();
  const active = useActiveSos();
  const mine = active.data?.find((s) => s.myRole === 'requester') ?? null;
  const helping = active.data?.find((s) => s.myRole !== 'requester') ?? null;

  useEffect(() => {
    if (mine) router.replace(`/sos/${mine.id}`);
  }, [mine, router]);

  if (active.isPending || mine) return <RequestSkeleton />;
  return <RequestFlow helping={helping} />;
}

function RequestSkeleton() {
  const t = useTranslations('states');
  return (
    <div aria-busy="true" className="mx-auto flex w-full max-w-narrow flex-col gap-4 pt-2">
      <span className="sr-only">{t('loading')}</span>
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-16 w-full rounded-2xl" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function RequestFlow({ helping }: { helping: SosDto | null }) {
  const t = useTranslations('sos.request');
  const me = useCurrentUser();
  const router = useRouter();
  const online = useOnlineStatus();
  const { position: sharedPosition } = useLocationSharing();
  const create = useCreateSos();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [step, setStep] = useState<Step>('type');
  const [type, setType] = useState<SosType | null>(null);
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<SosPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [location, setLocation] = useState<LatLng | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [sharePhone, setSharePhone] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);

  const goTo = (next: Step) => {
    setStep(next);
    setSubmitError(null);
    // Move focus to the step heading so screen readers announce the new step.
    requestAnimationFrame(() => headingRef.current?.focus());
    window.scrollTo({ top: 0 });
  };

  // A fresh shared fix is a good starting point; the driver can still drag the pin.
  useEffect(() => {
    if (!location && sharedPosition) setLocation({ lat: round6(sharedPosition.lat), lng: round6(sharedPosition.lng) });
  }, [sharedPosition, location]);

  const gate =
    !me.phoneVerified || !me.phone
      ? new ApiError({ status: 403, code: 'PHONE_NOT_VERIFIED', message: '' })
      : me.rating < RATING.sosCreateMin
        ? new ApiError({ status: 403, code: 'RATING_TOO_LOW', message: '' })
        : null;

  const openActive = useCallback(async () => {
    try {
      const list = await sosApi.active();
      const own = list.find((s) => s.myRole === 'requester');
      if (own) router.push(`/sos/${own.id}`);
    } catch {
      router.push('/sos/history');
    }
  }, [router]);

  const submit = async () => {
    if (!type) return goTo('type');
    if (!location) {
      setLocationError(t('locationRequired'));
      return goTo('details');
    }
    setSubmitError(null);
    try {
      const sos = await create.mutateAsync({
        type,
        description: description.trim(),
        photoUploadIds: photos.map((p) => p.id),
        lat: location.lat,
        lng: location.lng,
        sharePhone,
      });
      notify.success(t('sentToast'));
      router.replace(`/sos/${sos.id}`);
    } catch (error) {
      setSubmitError(error);
    }
  };

  const stepIndex = STEPS.indexOf(step);
  const accident = type === 'accident';

  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-5" data-testid="sos-request">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={step === 'type' ? null : <EmergencyCallButton variant="compact" className="hidden sm:inline-flex" />}
      />

      {/* "Call 112" first: at the top of the flow, and always first for an accident (DESIGN §10.3). */}
      {step === 'type' || accident ? <EmergencyCallButton /> : null}

      {helping ? (
        <Link
          href={`/sos/${helping.id}`}
          className="flex items-center gap-3 rounded-2xl border bg-card p-4 hover:bg-accent focus-ring"
          data-testid="sos-helping-banner"
        >
          <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
            <HandHelping className="size-5" />
          </span>
          <span className="min-w-0 flex-1 text-[0.9375rem]">{t('helpingBanner', { name: helping.requester.name || `@${helping.requester.nickname}` })}</span>
          <span className="text-sm font-semibold text-primary">{t('helpingOpen')}</span>
        </Link>
      ) : null}

      {gate ? (
        <SosGuidanceNotice error={gate} context="create" />
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-muted-foreground" aria-live="polite">
              {t('steps.label', { step: stepIndex + 1, total: STEPS.length })}
            </p>
            <div aria-hidden="true" className="flex gap-1.5">
              {STEPS.map((s, i) => (
                <span key={s} className={cn('h-1.5 flex-1 rounded-full', i <= stepIndex ? 'bg-sos' : 'bg-muted')} />
              ))}
            </div>
            <h2 ref={headingRef} tabIndex={-1} className="mt-2 text-xl font-semibold tracking-tight outline-none">
              {t(`steps.${step}`)}
            </h2>
          </div>

          {step === 'type' ? (
            <TypeStep
              value={type}
              onChange={(next) => {
                setType(next);
                goTo('details');
              }}
            />
          ) : null}

          {step === 'details' ? (
            <DetailsStep
              description={description}
              onDescription={setDescription}
              photos={photos}
              onPhotos={setPhotos}
              onUploading={setUploading}
              location={location}
              onLocation={(next) => {
                setLocation(next);
                setLocationError(null);
              }}
              locationError={locationError}
              onLocationError={setLocationError}
              sharePhone={sharePhone}
              onSharePhone={setSharePhone}
            />
          ) : null}

          {step === 'confirm' && type && location ? (
            <ConfirmStep type={type} description={description} photos={photos} location={location} sharePhone={sharePhone} />
          ) : null}

          {submitError ? (
            <SosGuidanceNotice
              error={submitError}
              context="create"
              onAction={(kind) => {
                if (kind === 'open_active') void openActive();
                else if (kind === 'reload') router.refresh();
              }}
            />
          ) : null}

          {step !== 'type' ? (
            <div className="sticky bottom-[calc(var(--nav-height)+var(--safe-bottom)+0.5rem)] z-raised flex flex-col-reverse gap-2 rounded-2xl border bg-background/95 p-2 shadow-md backdrop-blur-md sm:flex-row sm:justify-end lg:bottom-4">
              <Button variant="ghost" size="lg" leadingIcon={<ArrowLeft aria-hidden="true" className="rtl:rotate-180" />} onClick={() => goTo(step === 'confirm' ? 'details' : 'type')}>
                {t('back')}
              </Button>
              {step === 'details' ? (
                <Button
                  size="lg"
                  disabled={uploading}
                  onClick={() => {
                    if (!location) {
                      setLocationError(t('locationRequired'));
                      return;
                    }
                    goTo('confirm');
                  }}
                >
                  {t('review')}
                </Button>
              ) : (
                <Button
                  variant="sos"
                  size="lg"
                  leadingIcon={<Siren aria-hidden="true" />}
                  loading={create.isPending}
                  disabled={!online}
                  onClick={() => void submit()}
                  data-testid="sos-send"
                >
                  {t('send')}
                </Button>
              )}
            </div>
          ) : null}
        </>
      )}

      <SosEmergencyFooter />

      <p className="text-center text-sm text-muted-foreground">
        {t('wantToHelp')}{' '}
        <Link href="/sos/nearby" className="font-medium text-primary underline-offset-4 hover:underline focus-ring rounded-sm">
          {t('nearbyLink')}
        </Link>
      </p>
    </div>
  );
}

/** One button per type: choosing one moves on (a radio group would advance on arrow keys). */
function TypeStep({ value, onChange }: { value: SosType | null; onChange: (type: SosType) => void }) {
  const t = useTranslations('sos');
  return (
    <ul aria-label={t('request.typeLegend')} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {SOS_TYPES.map((type) => {
        const Icon = SOS_TYPE_ICONS[type];
        const selected = value === type;
        return (
          <li key={type}>
            <button
              type="button"
              aria-pressed={selected}
              data-testid={`sos-type-${type}`}
              onClick={() => onChange(type)}
              className={cn(
                'group flex w-full min-h-16 items-center gap-3 rounded-xl border bg-card p-3 text-start transition-[border-color,background-color] duration-fast focus-ring hover:border-input',
                selected && 'border-primary bg-primary-soft',
                type === 'accident' && 'border-sos/50',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-11 shrink-0 items-center justify-center rounded-lg',
                  type === 'accident' ? 'bg-sos-soft text-sos-soft-foreground' : 'bg-muted text-foreground',
                )}
              >
                <Icon className="size-5" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold text-foreground">{t(`types.${type}`)}</span>
                <span className="text-sm text-muted-foreground">{t(`typeHints.${type}`)}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function DetailsStep(props: {
  description: string;
  onDescription: (v: string) => void;
  photos: SosPhoto[];
  onPhotos: (v: SosPhoto[]) => void;
  onUploading: (busy: boolean) => void;
  location: LatLng | null;
  onLocation: (v: LatLng) => void;
  locationError: string | null;
  onLocationError: (v: string | null) => void;
  sharePhone: boolean;
  onSharePhone: (v: boolean) => void;
}) {
  const t = useTranslations('sos.request');
  const { location, onLocation, onLocationError } = props;
  const mapRef = useRef<MlMap | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoProblem, setGeoProblem] = useState<'denied' | 'unavailable' | null>(null);
  const photosHintId = useId();
  const shareId = useId();
  const locationId = useId();

  const locate = useCallback(async () => {
    setLocating(true);
    setGeoProblem(null);
    try {
      const c = await getCurrentPosition({ maximumAgeMs: 60_000 });
      onLocation({ lat: round6(c.lat), lng: round6(c.lng) });
      mapRef.current?.easeTo({ center: [c.lng, c.lat], zoom: 16 });
    } catch (error) {
      setGeoProblem(error instanceof GeoError ? error.reason : 'unavailable');
    } finally {
      setLocating(false);
    }
  }, [onLocation]);

  // Location is required: ask for it as soon as the driver reaches this step (they started an SOS).
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || location) return;
    asked.current = true;
    void locate();
  }, [locate, location]);

  const pinAtCentre = () => {
    const c = mapRef.current?.getCenter();
    if (c) {
      onLocation({ lat: round6(c.lat), lng: round6(c.lng) });
      onLocationError(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <FormField label={t('descriptionLabel')} hint={t('descriptionHint')}>
        <Textarea
          value={props.description}
          onChange={(e) => props.onDescription(e.target.value)}
          maxLength={SOS_LIMITS.descriptionMax}
          showCount
          rows={3}
          placeholder={t('descriptionPlaceholder')}
          enterKeyHint="next"
        />
      </FormField>

      <div className="flex flex-col gap-1.5">
        <Label>{t('photos')}</Label>
        <p id={photosHintId} className="text-sm text-muted-foreground">
          {t('photosHint', { max: SOS_LIMITS.photosMax })}
        </p>
        <SosPhotosField value={props.photos} onChange={props.onPhotos} onBusyChange={props.onUploading} describedBy={photosHintId} />
      </div>

      <section aria-labelledby={locationId} className="flex flex-col gap-2">
        <h3 id={locationId} className="flex items-center gap-1 text-[0.9375rem] font-medium">
          {t('location')}
          <span aria-hidden="true" className="text-danger">
            *
          </span>
        </h3>
        <p className="text-sm text-muted-foreground">{t('locationHint')}</p>
        <SosMap
          value={location}
          onChange={(next) => {
            onLocation(next);
            onLocationError(null);
          }}
          label={t('mapLabel')}
          className={cn('h-56 sm:h-64', props.locationError && 'border-danger')}
          zoom={location ? 16 : 11}
          onMapReady={(map) => {
            mapRef.current = map;
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" leadingIcon={<LocateFixed aria-hidden="true" />} loading={locating} onClick={() => void locate()}>
            {locating ? t('locating') : t('useMyLocation')}
          </Button>
          <Button variant="ghost" size="sm" leadingIcon={<Crosshair aria-hidden="true" />} onClick={pinAtCentre}>
            {t('pinAtCentre')}
          </Button>
        </div>
        {location ? (
          <p className="flex items-center gap-1.5 text-sm tabular-nums text-muted-foreground" data-testid="sos-location">
            <MapPin aria-hidden="true" className="size-4 shrink-0" />
            {t('locationSet', { lat: location.lat.toFixed(5), lng: location.lng.toFixed(5) })}
          </p>
        ) : null}
        {geoProblem ? (
          <p className="text-sm text-muted-foreground" role="status">
            {geoProblem === 'denied' ? t('locationDenied') : t('locationUnavailable')}
          </p>
        ) : null}
        {props.locationError ? (
          <p role="alert" className="text-sm text-danger">
            {props.locationError}
          </p>
        ) : null}
      </section>

      <div className="flex items-start justify-between gap-4 rounded-2xl border bg-card p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={shareId} className="text-[0.9375rem]">
            {t('sharePhone')}
          </Label>
          <p id={`${shareId}-hint`} className="flex items-start gap-1.5 text-sm text-muted-foreground" aria-live="polite">
            {props.sharePhone ? <Phone aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : <PhoneOff aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
            {props.sharePhone ? t('sharePhoneOn') : t('sharePhoneOff')}
          </p>
        </div>
        <Switch id={shareId} checked={props.sharePhone} onCheckedChange={props.onSharePhone} aria-describedby={`${shareId}-hint`} />
      </div>
    </div>
  );
}

function ConfirmStep({
  type,
  description,
  photos,
  location,
  sharePhone,
}: {
  type: SosType;
  description: string;
  photos: SosPhoto[];
  location: LatLng;
  sharePhone: boolean;
}) {
  const t = useTranslations('sos');
  return (
    <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:p-5" data-testid="sos-confirm">
      <div className="flex items-center gap-3">
        <SosTypeTile type={type} />
        <div className="flex min-w-0 flex-col">
          <span className="text-sm text-muted-foreground">{t('request.summary.type')}</span>
          <span className="text-lg font-semibold">{t(`types.${type}`)}</span>
        </div>
      </div>
      <dl className="grid grid-cols-1 gap-3 text-[0.9375rem]">
        <div className="flex flex-col gap-0.5">
          <dt className="text-sm text-muted-foreground">{t('request.summary.description')}</dt>
          <dd className="whitespace-pre-line break-words">{description.trim() || <span className="text-muted-foreground">{t('request.summary.noDescription')}</span>}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">{t('request.photos')}</dt>
          <dd>
            {photos.length > 0 ? (
              <ul className="flex gap-2">
                {photos.map((p, i) => (
                  <li key={p.id} className="size-14 overflow-hidden rounded-lg border bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element -- uploaded media */}
                    <img src={p.url} alt={t('request.photoAlt', { index: i + 1 })} className="size-full object-cover" />
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">{t('request.summary.photos', { count: 0 })}</span>
            )}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">{t('request.location')}</dt>
          <dd className="flex flex-col gap-2">
            <SosMap value={location} label={t('card.mapLabel')} className="h-36" zoom={15} interactive={false} />
            <span className="text-sm tabular-nums text-muted-foreground">
              {t('request.locationSet', { lat: location.lat.toFixed(5), lng: location.lng.toFixed(5) })}
            </span>
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-sm text-muted-foreground">{t('request.summary.phone')}</dt>
          <dd>{sharePhone ? t('request.summary.phoneShared') : t('request.summary.phoneHidden')}</dd>
        </div>
      </dl>
    </div>
  );
}
