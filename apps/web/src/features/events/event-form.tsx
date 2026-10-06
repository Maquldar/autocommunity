'use client';

import { EVENT_LIMITS, type EventDto, type RoutePoint } from '@autoc/shared';
import { Eraser, LocateFixed, MapPin, Route, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Textarea } from '@/components/ui/textarea';
import { getCurrentPosition } from '@/components/services/use-position';
import type { EventBody } from './api';
import { EventMap } from './event-map';
import { fromZonedInput, toZonedInput } from './time';

type LatLng = { lat: number; lng: number };
type Errors = Partial<Record<'title' | 'description' | 'startsAt' | 'endsAt' | 'place' | 'location' | 'route', string>>;
type TapMode = 'place' | 'route';

export type EventFormValues = {
  title: string;
  description: string;
  startsAt: string; // datetime-local, Almaty
  endsAt: string;
  place: string;
  location: LatLng | null;
  route: RoutePoint[];
};

export function initialValues(event?: EventDto): EventFormValues {
  if (!event) return { title: '', description: '', startsAt: '', endsAt: '', place: '', location: null, route: [] };
  return {
    title: event.title,
    description: event.description,
    startsAt: toZonedInput(event.startsAt),
    endsAt: event.endsAt ? toZonedInput(event.endsAt) : '',
    place: event.place,
    location: { lat: event.lat, lng: event.lng },
    route: event.route ?? [],
  };
}

/** Field rules (the API checks them again); returns the request body or the errors to show. */
export function validateEvent(
  v: EventFormValues,
  t: (key: string, values?: Record<string, number>) => string,
  { requireFuture = true, now = Date.now() }: { requireFuture?: boolean; now?: number } = {},
): { body: EventBody | null; errors: Errors } {
  const errors: Errors = {};
  const title = v.title.trim();
  const place = v.place.trim();
  if (title.length < EVENT_LIMITS.titleMin || title.length > EVENT_LIMITS.titleMax) errors.title = t('form.errors.title', { min: EVENT_LIMITS.titleMin, max: EVENT_LIMITS.titleMax });
  if (v.description.trim().length > EVENT_LIMITS.descriptionMax) errors.description = t('form.errors.description', { max: EVENT_LIMITS.descriptionMax });
  if (place.length < EVENT_LIMITS.placeMin || place.length > EVENT_LIMITS.placeMax) errors.place = t('form.errors.place', { min: EVENT_LIMITS.placeMin, max: EVENT_LIMITS.placeMax });
  if (!v.location) errors.location = t('form.errors.location');
  const startsAt = v.startsAt ? fromZonedInput(v.startsAt) : null;
  const endsAt = v.endsAt ? fromZonedInput(v.endsAt) : null;
  if (!startsAt) errors.startsAt = t('form.errors.startsAt');
  else if (requireFuture && new Date(startsAt).getTime() <= now) errors.startsAt = t('form.errors.startsPast');
  else if (new Date(startsAt).getTime() > now + EVENT_LIMITS.maxAheadDays * 86_400_000) errors.startsAt = t('form.errors.startsFar');
  if (v.endsAt && !endsAt) errors.endsAt = t('form.errors.endsAt');
  else if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) errors.endsAt = t('form.errors.endsBefore');
  if (v.route.length === 1) errors.route = t('form.errors.routeShort');
  if (v.route.length > EVENT_LIMITS.routeMax) errors.route = t('form.errors.routeLong', { max: EVENT_LIMITS.routeMax });
  if (Object.keys(errors).length) return { body: null, errors };
  return {
    body: {
      title,
      description: v.description.trim(),
      place,
      lat: v.location!.lat,
      lng: v.location!.lng,
      startsAt: startsAt!,
      endsAt,
      route: v.route.length >= 2 ? v.route : null,
    },
    errors,
  };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Create / edit an event: text fields, Almaty date-time pickers and one map. Tapping the map sets the
 * place or appends a route point (SegmentedControl), with "use my position", undo and clear.
 */
export function EventForm({
  initial,
  submitLabel,
  pending,
  serverError,
  requireFuture = true,
  onSubmit,
  onCancel,
}: {
  initial: EventFormValues;
  submitLabel: string;
  pending: boolean;
  serverError?: string | null;
  requireFuture?: boolean;
  onSubmit: (body: EventBody) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations('events');
  const tc = useTranslations('common');
  const [values, setValues] = useState<EventFormValues>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [mode, setMode] = useState<TapMode>(initial.location ? 'route' : 'place');
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const set = <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const tt = (key: string, vals?: Record<string, number>) => t(key as never, vals as never);

  const pick = (p: LatLng) => {
    if (mode === 'place') {
      set('location', p);
      if (errors.location) setErrors((e) => ({ ...e, location: undefined }));
    } else if (values.route.length < EVENT_LIMITS.routeMax) {
      setValues((v) => ({ ...v, route: [...v.route, [p.lng, p.lat]] }));
      if (errors.route) setErrors((e) => ({ ...e, route: undefined }));
    }
  };

  const locate = async () => {
    setGeoError(null);
    setLocating(true);
    try {
      const c = await getCurrentPosition();
      set('location', { lat: round6(c.lat), lng: round6(c.lng) });
      setErrors((e) => ({ ...e, location: undefined }));
    } catch {
      setGeoError(t('form.locationUnavailable'));
    } finally {
      setLocating(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validateEvent(values, tt, { requireFuture });
    setErrors(result.errors);
    if (!result.body) {
      // Focus the first invalid control.
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    onSubmit(result.body);
  };

  return (
    <form ref={formRef} noValidate onSubmit={submit} className="flex flex-col gap-5" data-testid="event-form">
      <FormField label={t('form.title')} required error={errors.title}>
        <Input value={values.title} maxLength={EVENT_LIMITS.titleMax + 20} onChange={(e) => set('title', e.target.value)} autoComplete="off" />
      </FormField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label={t('form.startsAt')} required error={errors.startsAt} hint={t('form.timeZoneHint')}>
          <Input type="datetime-local" value={values.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
        </FormField>
        <FormField label={`${t('form.endsAt')} (${tc('optional')})`} error={errors.endsAt}>
          <Input type="datetime-local" value={values.endsAt} min={values.startsAt || undefined} onChange={(e) => set('endsAt', e.target.value)} />
        </FormField>
      </div>

      <FormField label={t('form.place')} required error={errors.place} hint={t('form.placeHint')}>
        <Input value={values.place} maxLength={EVENT_LIMITS.placeMax + 20} onChange={(e) => set('place', e.target.value)} autoComplete="off" />
      </FormField>

      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-1.5 text-sm font-medium">
          {t('form.mapLegend')}
          <span aria-hidden="true" className="text-danger"> *</span>
        </legend>
        <SegmentedControl
          label={t('form.tapMode')}
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'place', label: t('form.modePlace'), icon: <MapPin aria-hidden="true" className="size-4" /> },
            { value: 'route', label: t('form.modeRoute'), icon: <Route aria-hidden="true" className="size-4" /> },
          ]}
        />
        <p className="text-sm text-muted-foreground" id="event-map-hint">
          {mode === 'place' ? t('form.placeTapHint') : t('form.routeTapHint')}
        </p>
        <EventMap
          place={values.location}
          route={values.route}
          onPick={pick}
          editing
          label={t('form.mapLabel')}
          placeLabel={t('form.placeMarker')}
          className={errors.location ? 'h-72 border-danger sm:h-96' : 'h-72 sm:h-96'}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" leadingIcon={<LocateFixed aria-hidden="true" />} loading={locating} onClick={() => void locate()}>
            {t('form.useMyPosition')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            leadingIcon={<Undo2 aria-hidden="true" />}
            disabled={!values.route.length}
            onClick={() => set('route', values.route.slice(0, -1))}
            data-testid="route-undo"
          >
            {t('form.undoPoint')}
          </Button>
          <Button variant="ghost" size="sm" leadingIcon={<Eraser aria-hidden="true" />} disabled={!values.route.length} onClick={() => set('route', [])}>
            {t('form.clearRoute')}
          </Button>
        </div>
        <div className="flex flex-col gap-1 text-sm" aria-live="polite">
          <p className={values.location ? 'tabular-nums text-muted-foreground' : 'text-muted-foreground'} data-testid="picked-location">
            {values.location ? t('form.placeSet', { lat: values.location.lat.toFixed(5), lng: values.location.lng.toFixed(5) }) : t('form.placeNotSet')}
          </p>
          <p className="text-muted-foreground" data-testid="route-points">
            {t('form.routePoints', { count: values.route.length })}
          </p>
        </div>
        {geoError ? <p className="text-sm text-muted-foreground">{geoError}</p> : null}
        <FormError>{errors.location ?? errors.route}</FormError>
      </fieldset>

      <FormField label={`${t('form.description')} (${tc('optional')})`} error={errors.description}>
        <Textarea rows={4} showCount maxLength={EVENT_LIMITS.descriptionMax} value={values.description} onChange={(e) => set('description', e.target.value)} />
      </FormField>

      <FormError>{serverError}</FormError>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            {tc('cancel')}
          </Button>
        ) : null}
        <Button type="submit" size="lg" loading={pending} className="max-sm:w-full">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
