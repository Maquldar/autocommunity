'use client';

import type { UploadDto, UserPublic } from '@autoc/shared';
import { CarFront, Check, ChevronLeft, ChevronRight, CircleAlert, Info, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useState, type ReactNode } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { EmergencyCallButton } from '@/components/ui/emergency-call-button';
import { IconButton } from '@/components/ui/icon-button';
import { RatingBadge } from '@/components/ui/rating-badge';
import { useErrorMessage } from '@/hooks/use-error-message';
import { cn } from '@/lib/cn';
import { distanceParts } from './format';
import { sosGuidance, type SosGuidance, type SosGuidanceContext } from './guidance';
import type { TimelineStep } from './view-model';

/** "1.2 km" / "350 m" in the viewer's locale. */
export function useDistance(): (meters: number) => string {
  const format = useFormatter();
  return useCallback(
    (meters: number) => {
      const { value, unit } = distanceParts(meters);
      return format.number(value, { style: 'unit', unit, unitDisplay: 'short' });
    },
    [format],
  );
}

/** Call 112 + "AutoCommunity doesn't replace emergency services". On every SOS screen (DESIGN §10.3). */
export function SosEmergencyFooter({ variant = 'compact', className }: { variant?: 'full' | 'compact'; className?: string }) {
  const t = useTranslations('emergency');
  return (
    <aside
      aria-label={t('call112')}
      className={cn('flex flex-col gap-3 rounded-2xl border border-dashed bg-card/60 p-4 sm:flex-row sm:items-center', className)}
    >
      <EmergencyCallButton variant={variant} className={variant === 'compact' ? 'self-start' : undefined} />
      <p className="text-sm text-muted-foreground text-pretty" data-testid="sos-disclaimer">
        {t('disclaimer')}
      </p>
    </aside>
  );
}

/** created → accepted → in_progress → closed / cancelled / expired as an ordered list with done/current marks. */
export function SosTimeline({ steps, className }: { steps: TimelineStep[]; className?: string }) {
  const t = useTranslations('sos.timeline');
  return (
    <ol aria-label={t('label')} className={cn('flex flex-col', className)} data-testid="sos-timeline">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const terminalBad = step.key === 'cancelled' || step.key === 'expired';
        return (
          <li key={step.key} className="relative flex gap-3 pb-4 last:pb-0" data-step={step.key} data-state={step.state} aria-current={step.state === 'current' ? 'step' : undefined}>
            {last ? null : (
              <span
                aria-hidden="true"
                className={cn('absolute start-[0.6875rem] top-6 h-[calc(100%-1.25rem)] w-0.5 rounded-full', step.state === 'done' ? 'bg-primary' : 'bg-border')}
              />
            )}
            <span
              aria-hidden="true"
              className={cn(
                'relative flex size-6 shrink-0 items-center justify-center rounded-full border-2',
                step.state === 'done' && 'border-primary bg-primary text-primary-foreground',
                step.state === 'current' && !terminalBad && step.key !== 'closed' && 'border-sos bg-card',
                step.state === 'current' && step.key === 'closed' && 'border-success bg-success text-success-foreground',
                step.state === 'current' && terminalBad && 'border-input bg-muted',
                step.state === 'upcoming' && 'border-input bg-card',
              )}
            >
              {step.state === 'done' || (step.state === 'current' && step.key === 'closed') ? (
                <Check className="size-3.5" strokeWidth={3} />
              ) : step.state === 'current' && !terminalBad ? (
                <span className="size-2.5 rounded-full bg-sos motion-safe:animate-sos-pulse" />
              ) : null}
            </span>
            <span className={cn('pt-0.5 text-[0.9375rem]', step.state === 'upcoming' ? 'text-muted-foreground' : 'font-medium text-foreground')}>
              {t(step.key)}
              <span className="sr-only">, {t(step.state)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Requester / helper identity: avatar, name, @nickname, trust badge, car, plus extra lines. */
export function PersonSummary({ user, children, href = true }: { user: UserPublic; children?: ReactNode; href?: boolean }) {
  const t = useTranslations('sos.card');
  const name = user.name || `@${user.nickname}`;
  const car = user.primaryVehicle;
  const identity = (
    <>
      <Avatar id={user.id} name={name} src={user.avatarUrl} size="lg" decorative />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="break-words text-base font-semibold leading-6">{name}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <RatingBadge rating={user.rating} showLabel size="sm" />
          <span className="break-all">@{user.nickname}</span>
        </span>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CarFront aria-hidden="true" className="size-4 shrink-0" />
          {car ? <span className="break-words text-foreground">{`${car.brand} ${car.model}${car.year ? `, ${car.year}` : ''}`}</span> : t('noCar')}
        </span>
        {children}
      </span>
    </>
  );
  return href ? (
    <Link href={`/u/${user.id}`} className="-m-1 flex min-w-0 items-start gap-3 rounded-xl p-1 hover:bg-accent focus-ring">
      {identity}
    </Link>
  ) : (
    <div className="flex min-w-0 items-start gap-3">{identity}</div>
  );
}

/** Photo thumbnails; tapping opens a full-size viewer with previous/next (arrow keys too). */
export function SosPhotos({ photos, name }: { photos: UploadDto[]; name: string }) {
  const t = useTranslations('sos.card');
  const tc = useTranslations('common');
  const [open, setOpen] = useState<number | null>(null);
  if (photos.length === 0) return null;
  const current = open === null ? null : photos[open];
  const go = (delta: number) => setOpen((i) => (i === null ? i : (i + delta + photos.length) % photos.length));
  return (
    <section aria-label={t('photos')}>
      <ul className="grid grid-cols-4 gap-2">
        {photos.map((p, i) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => setOpen(i)}
              className="block aspect-square w-full overflow-hidden rounded-xl border bg-muted focus-ring"
              aria-label={t('openPhoto', { index: i + 1 })}
              data-testid="sos-photo"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- user media from the API host */}
              <img src={p.thumbUrl ?? p.url} alt="" className="size-full object-cover" loading="lazy" />
            </button>
          </li>
        ))}
      </ul>
      <Dialog open={current !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent
          className="max-w-3xl gap-3 p-3 sm:p-4"
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') go(1);
            if (e.key === 'ArrowLeft') go(-1);
          }}
        >
          <DialogTitle className="pe-10 text-base">
            {name} · {t('photo', { index: (open ?? 0) + 1, total: photos.length })}
          </DialogTitle>
          {current ? (
            // eslint-disable-next-line @next/next/no-img-element -- user media from the API host
            <img src={current.url} alt={t('photo', { index: (open ?? 0) + 1, total: photos.length })} className="max-h-[70dvh] w-full rounded-xl bg-muted object-contain" />
          ) : null}
          {photos.length > 1 ? (
            <div className="flex justify-center gap-2">
              <IconButton aria-label={tc('back')} variant="outline" onClick={() => go(-1)}>
                <ChevronLeft className="rtl:rotate-180" />
              </IconButton>
              <IconButton aria-label={tc('next')} variant="outline" onClick={() => go(1)}>
                <ChevronRight className="rtl:rotate-180" />
              </IconButton>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

const TONE_CLASSES: Record<SosGuidance['tone'], string> = {
  danger: 'border-danger/40 bg-danger-soft text-danger-soft-foreground',
  warning: 'border-warning/40 bg-warning-soft text-warning-soft-foreground',
  info: 'border-primary/30 bg-primary-soft text-primary-soft-foreground',
};

/**
 * Gate errors with what to do next (verify phone, open my SOS, share location…). Falls back to the
 * generic error message for anything that isn't SOS-specific.
 */
export function SosGuidanceNotice({
  error,
  context,
  onAction,
  className,
}: {
  error: unknown;
  context: SosGuidanceContext;
  /** Handles `open_active`, `share_location` and `reload` (links are rendered here). */
  onAction?: (kind: 'open_active' | 'share_location' | 'reload') => void;
  className?: string;
}) {
  const t = useTranslations('sos.guidance');
  const errorMessage = useErrorMessage();
  const format = useFormatter();
  const guidance = sosGuidance(error, context);

  if (!guidance) {
    return (
      <div role="alert" className={cn('flex items-start gap-2 rounded-xl border px-4 py-3 text-sm', TONE_CLASSES.danger, className)}>
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{errorMessage(error)}</span>
      </div>
    );
  }

  const { key, values = {}, action, tone } = guidance;
  const until = values.until ? format.dateTime(values.until, { dateStyle: 'medium', timeStyle: 'short' }) : null;
  const time = values.retryAt ? format.dateTime(values.retryAt, { hour: '2-digit', minute: '2-digit' }) : null;
  let body: string;
  if (key === 'banned') body = until ? t('banned.body', { until }) : t('banned.bodyNoDate');
  else if (key === 'rateLimit') body = time ? t('rateLimit.body', { time, max: 3 }) : t('rateLimit.bodyNoTime', { max: 3 });
  else if (key === 'ratingTooLowCreate' || key === 'ratingTooLowHelp') body = t(`${key}.body`, { min: values.min ?? 0 });
  else body = t(`${key}.body`);

  const Icon = tone === 'info' ? Info : TriangleAlert;
  return (
    <div role="alert" className={cn('flex flex-col gap-3 rounded-2xl border p-4', TONE_CLASSES[tone], className)} data-testid="sos-guidance" data-guidance={key}>
      <div className="flex items-start gap-3">
        <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-semibold">{t(`${key}.title`)}</p>
          <p className="text-sm text-pretty">{body}</p>
        </div>
      </div>
      {action ? (
        <div className="flex flex-wrap gap-2 ps-8">
          {action.kind === 'link' ? (
            <Button asChild size="sm" variant="outline" className="bg-card">
              <Link href={action.href}>{t(`actions.${action.label}`)}</Link>
            </Button>
          ) : onAction ? (
            <Button size="sm" variant="outline" className="bg-card" onClick={() => onAction(action.kind)}>
              {t(action.kind === 'open_active' ? 'actions.openActive' : action.kind === 'share_location' ? 'actions.shareLocation' : 'actions.reload')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
