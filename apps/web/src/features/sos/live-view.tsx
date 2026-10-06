'use client';

import { SOS_LIMITS, type SosDto, type SosResponseDto } from '@autoc/shared';
import {
  Check,
  CheckCheck,
  Clock,
  Copy,
  Hourglass,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  Radar,
  SearchX,
  Share2,
  UserCheck,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmergencyCallButton } from '@/components/ui/emergency-call-button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { hasErrorCode } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import { useOpenDirectChat } from '@/features/chats/queries';
import { ReviewSheet } from '@/features/rating/review-sheet';
import { ReportButton } from '@/features/reports/report-dialog';
import {
  useAcceptResponse,
  useArrivedSos,
  useCancelSos,
  useCloseSos,
  useDeclineResponse,
  useRespondSos,
  useShareSos,
  useSos,
  useWithdrawSos,
} from './api';
import { formatCountdown, formatPhone, navigateUrl, nextRadiusStep, osmUrl, radiusKm, telHref } from './format';
import { PersonSummary, SosEmergencyFooter, SosGuidanceNotice, SosPhotos, SosTimeline, useDistance } from './parts';
import { SosMap } from './sos-map';
import { SosStatusBadge, SosTypeTile } from './sos-type';
import { helperView, isSosOpen, requesterView, timelineSteps } from './view-model';

/** Re-renders every second while `active` (countdowns). */
function useSecondTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/** /sos/[id] — the live page. The requester and helpers/viewers see different screens of the same SOS. */
export function SosLiveView({ id }: { id: string }) {
  const t = useTranslations('sos');
  const errorMessage = useErrorMessage();
  const sos = useSos(id);

  if (sos.isPending) return <LiveSkeleton />;
  if (sos.isError && !sos.data) {
    if (hasErrorCode(sos.error, 'NOT_FOUND') || hasErrorCode(sos.error, 'VALIDATION_ERROR')) {
      return (
        <div className="mx-auto flex w-full max-w-narrow flex-col gap-6 pt-6">
          <EmptyState
            icon={SearchX}
            title={t('guidance.notFound.title')}
            description={t('guidance.notFound.body')}
            action={
              <Button asChild>
                <Link href="/sos/nearby">{t('nearby.title')}</Link>
              </Button>
            }
          />
          <SosEmergencyFooter />
        </div>
      );
    }
    return (
      <div className="mx-auto flex w-full max-w-narrow flex-col gap-6 pt-6">
        <ErrorState description={errorMessage(sos.error)} onRetry={() => void sos.refetch()} retrying={sos.isFetching} />
        <SosEmergencyFooter />
      </div>
    );
  }
  const data = sos.data!;
  return data.myRole === 'requester' ? <RequesterLive sos={data} /> : <HelperLive sos={data} onReload={() => void sos.refetch()} />;
}

function LiveSkeleton() {
  const t = useTranslations('states');
  return (
    <div aria-busy="true" className="mx-auto flex w-full max-w-narrow flex-col gap-4 pt-2">
      <span className="sr-only">{t('loading')}</span>
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-36 w-full rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-44 w-full rounded-2xl" />
    </div>
  );
}

/* ---------- shared ---------- */

/** Type, status, age (and distance for helpers). The page's visual anchor. */
function SosHero({ sos, children }: { sos: SosDto; children?: ReactNode }) {
  const t = useTranslations('sos');
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const distance = useDistance();
  return (
    <Card className={cn('flex flex-col gap-4 p-4 sm:p-5', isSosOpen(sos.status) && 'border-sos/40')} data-testid="sos-hero">
      <div className="flex items-start gap-3">
        <SosTypeTile type={sos.type} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="text-xl font-semibold leading-7 tracking-tight break-words" data-testid="sos-type">
            {t(`types.${sos.type}`)}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
            <SosStatusBadge status={sos.status} />
            <span className="inline-flex items-center gap-1">
              <Clock aria-hidden="true" className="size-4" />
              <time dateTime={sos.createdAt}>{t('live.createdAgo', { time: format.relativeTime(new Date(sos.createdAt), now) })}</time>
            </span>
            {sos.myRole !== 'requester' ? (
              <span className="inline-flex items-center gap-1" data-testid="sos-distance">
                <MapPin aria-hidden="true" className="size-4" />
                {sos.distanceM !== null ? t('live.distance', { distance: distance(sos.distanceM) }) : t('live.distanceUnknown')}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      {children}
    </Card>
  );
}

/** Radius being searched, the next expansion and the expiry countdown (requester, while nobody accepted). */
function SearchStatus({ sos }: { sos: SosDto }) {
  const t = useTranslations('sos.live');
  const now = useSecondTicker(true);
  const leftSec = Math.max(0, Math.ceil((Date.parse(sos.expiresAt) - now) / 1000));
  const next = nextRadiusStep(sos.radiusM, sos.createdAt, now);
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-sos-soft p-3 text-sos-soft-foreground" data-testid="sos-search">
      <p className="flex items-center gap-2 font-semibold" role="status">
        <Radar aria-hidden="true" className="size-5 shrink-0 motion-safe:animate-pulse" />
        <span data-testid="sos-radius" data-radius={sos.radiusM}>
          {t('searching', { km: radiusKm(sos.radiusM) })}
        </span>
      </p>
      <p className="text-sm">{t('notified')}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
        {next ? (
          <span>{next.inSec > 0 ? t('expanding', { km: radiusKm(next.radiusM), time: formatCountdown(next.inSec) }) : t('expandingNow', { km: radiusKm(next.radiusM) })}</span>
        ) : (
          <span>{t('widest', { km: radiusKm(SOS_LIMITS.visibleRadiusM) })}</span>
        )}
        <span className="inline-flex items-center gap-1" data-testid="sos-expiry">
          <Hourglass aria-hidden="true" className="size-4" />
          {leftSec > 0 ? t('expiresIn', { time: formatCountdown(leftSec) }) : t('expiresNow')}
        </span>
      </div>
    </div>
  );
}

function Section({ title, children, aside, testId }: { title: ReactNode; children: ReactNode; aside?: ReactNode; testId?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3" data-testid={testId}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function PhoneLink({ phone, label, size = 'lg' }: { phone: string; label: string; size?: 'md' | 'lg' }) {
  return (
    <Button asChild variant="outline" size={size} leadingIcon={<Phone aria-hidden="true" />} className="tabular-nums">
      <a href={telHref(phone)} aria-label={`${label}: ${formatPhone(phone)}`} data-testid="sos-phone">
        {formatPhone(phone)}
      </a>
    </Button>
  );
}

/* ---------- requester ---------- */

function RequesterLive({ sos }: { sos: SosDto }) {
  const t = useTranslations('sos');
  const view = requesterView(sos);
  const online = useOnlineStatus();
  const errorMessage = useErrorMessage();
  const arrived = useArrivedSos(sos.id);
  const close = useCloseSos(sos.id);
  const cancel = useCancelSos(sos.id);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState<unknown>(null);

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setActionError(null);
    try {
      await fn();
      notify.success(success);
    } catch (error) {
      setActionError(error);
      throw error;
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-6" data-testid="sos-live" data-role="requester" data-status={sos.status}>
      <PageHeader title={t('live.title')} back="/map" />
      {sos.type === 'accident' && view.open ? <EmergencyCallButton /> : null}

      <SosHero sos={sos}>{view.searching ? <SearchStatus sos={sos} /> : null}</SosHero>

      {view.open ? null : <EndedPanel sos={sos} />}
      <ReviewPrompt sos={sos} />

      <Card className="p-4 sm:p-5">
        <SosTimeline steps={timelineSteps(sos)} />
      </Card>

      {actionError ? <SosGuidanceNotice error={actionError} context="requester" /> : null}

      <Section
        title={t('live.offers')}
        testId="sos-offers"
        aside={
          view.acceptedCount > 0 ? (
            <span className="text-sm text-muted-foreground">{t('live.acceptedCount', { count: view.acceptedCount, max: SOS_LIMITS.maxAcceptedHelpers })}</span>
          ) : null
        }
      >
        {view.liveResponses.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-card p-6 text-center" data-testid="sos-no-offers">
            <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
              <Radar className="size-6" />
            </span>
            <p className="font-semibold">{view.open ? t('live.noOffers.title') : t('live.noOffers.titleEnded')}</p>
            {view.open ? <p className="text-sm text-muted-foreground text-pretty">{t('live.noOffers.body')}</p> : null}
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {view.liveResponses.map((response) => (
              <li key={response.id}>
                <ResponseCard sosId={sos.id} open={view.open} response={response} actions={view.responseActions(response)} onError={setActionError} />
              </li>
            ))}
          </ul>
        )}
        {view.pastResponses.length > 0 ? (
          <details className="rounded-xl border bg-card px-4 py-2 text-sm">
            <summary className="cursor-pointer py-1 font-medium text-muted-foreground">{t('live.pastOffers', { count: view.pastResponses.length })}</summary>
            <ul className="flex flex-col gap-2 py-2">
              {view.pastResponses.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{r.helper.name || `@${r.helper.nickname}`}</span>
                  <Badge size="sm">{t(`live.response.${r.status}`)}</Badge>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Section>

      {view.open || view.canOpenChat ? (
        <div className="flex flex-col gap-2" data-testid="sos-requester-actions">
          {view.canClose ? (
            <Button size="lg" fullWidth leadingIcon={<CheckCheck aria-hidden="true" />} disabled={!online} onClick={() => setConfirmClose(true)}>
              {t('live.close')}
            </Button>
          ) : null}
          {view.canMarkArrived ? (
            <Button
              size="lg"
              variant="secondary"
              fullWidth
              leadingIcon={<UserCheck aria-hidden="true" />}
              loading={arrived.isPending}
              disabled={!online}
              onClick={() => void run(() => arrived.mutateAsync(undefined), t('live.arrivedToast')).catch(() => undefined)}
            >
              {t('live.markArrived')}
            </Button>
          ) : null}
          {view.canOpenChat ? (
            <Button asChild size="lg" variant="secondary" fullWidth leadingIcon={<MessageCircle aria-hidden="true" />}>
              <Link href={`/chats/${sos.chatId}`}>{t('live.openChat')}</Link>
            </Button>
          ) : null}
          {view.canShare ? <ShareControl sosId={sos.id} /> : null}
        </div>
      ) : null}

      {view.canCancel ? (
        <div className="flex justify-center border-t pt-4">
          <Button variant="ghost" leadingIcon={<X aria-hidden="true" />} disabled={!online} onClick={() => setConfirmCancel(true)}>
            {t('live.cancel')}
          </Button>
        </div>
      ) : null}

      <SosEmergencyFooter />

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title={t('live.closeConfirm.title')}
        description={t('live.closeConfirm.description')}
        confirmLabel={t('live.closeConfirm.confirm')}
        onConfirm={() =>
          run(() => close.mutateAsync(undefined), t('live.closedToast')).catch((error) => {
            notify.error(errorMessage(error));
            throw error;
          })
        }
      />
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={(open) => {
          setConfirmCancel(open);
          if (!open) setReason('');
        }}
        title={t('live.cancelConfirm.title')}
        description={t('live.cancelConfirm.description')}
        confirmLabel={t('live.cancelConfirm.confirm')}
        cancelLabel={t('live.cancelConfirm.keep')}
        onConfirm={() =>
          run(() => cancel.mutateAsync(reason.trim() || undefined), t('live.cancelledToast')).catch((error) => {
            notify.error(errorMessage(error));
            throw error;
          })
        }
      >
        <FormField label={t('live.cancelConfirm.reason')} hint={t('live.cancelConfirm.reasonHint')}>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={SOS_LIMITS.descriptionMax}
            rows={2}
            placeholder={t('live.cancelConfirm.reasonPlaceholder')}
          />
        </FormField>
      </ConfirmDialog>
    </div>
  );
}

function ResponseCard({
  sosId,
  open,
  response,
  actions,
  onError,
}: {
  sosId: string;
  open: boolean;
  response: SosResponseDto;
  actions: ReturnType<ReturnType<typeof requesterView>['responseActions']>;
  onError: (error: unknown) => void;
}) {
  const t = useTranslations('sos.live');
  const online = useOnlineStatus();
  const distance = useDistance();
  const accept = useAcceptResponse(sosId);
  const decline = useDeclineResponse(sosId);
  const name = response.helper.name || `@${response.helper.nickname}`;
  const engaged = response.status === 'accepted' || response.status === 'arrived';

  const act = async (kind: 'accept' | 'decline') => {
    onError(null);
    try {
      if (kind === 'accept') {
        await accept.mutateAsync(response.id);
        notify.success(t('acceptedToast', { name }));
      } else {
        await decline.mutateAsync(response.id);
      }
    } catch (error) {
      onError(error);
    }
  };

  return (
    <Card
      className={cn('flex flex-col gap-3 p-4', engaged && 'border-success/50')}
      data-testid="sos-response"
      data-response-status={response.status}
    >
      <PersonSummary user={response.helper}>
        <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge size="sm" variant={engaged ? 'success' : 'primary'}>
            {engaged ? <Check aria-hidden="true" /> : null}
            {t(`response.${response.status}`)}
          </Badge>
          <span className="inline-flex items-center gap-1">
            <MapPin aria-hidden="true" className="size-3.5" />
            {response.distanceM !== null ? t('distance', { distance: distance(response.distanceM) }) : t('distanceHidden')}
          </span>
        </span>
      </PersonSummary>
      {actions.phone ? <PhoneLink phone={actions.phone} label={t('callLabel', { name })} /> : null}
      {actions.canAccept || actions.canDecline ? (
        <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
          {actions.canAccept ? (
            <Button
              size="lg"
              leadingIcon={<Check aria-hidden="true" />}
              loading={accept.isPending}
              disabled={!online || decline.isPending}
              onClick={() => void act('accept')}
              aria-label={t('acceptLabel', { name })}
            >
              {t('accept')}
            </Button>
          ) : null}
          {actions.canDecline ? (
            <Button
              size="lg"
              variant="secondary"
              loading={decline.isPending}
              disabled={!online || accept.isPending}
              onClick={() => void act('decline')}
              aria-label={t('declineLabel', { name })}
            >
              {t('decline')}
            </Button>
          ) : null}
        </div>
      ) : response.status === 'offered' && open ? (
        <p className="text-sm text-muted-foreground">{t('helperLimitHint', { max: SOS_LIMITS.maxAcceptedHelpers })}</p>
      ) : null}
    </Card>
  );
}

/** POST /share → Web Share sheet where available, otherwise copy; the link stays visible to copy again. */
function ShareControl({ sosId }: { sosId: string }) {
  const t = useTranslations('sos.live.share');
  const errorMessage = useErrorMessage();
  const share = useShareSos(sosId);
  const [url, setUrl] = useState<string | null>(null);
  const inputId = useId();

  const copy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      notify.success(t('copied'));
    } catch {
      // Clipboard blocked: the link is selectable in the field below.
    }
  };

  const onShare = async () => {
    try {
      const { url: link } = await share.mutateAsync();
      setUrl(link);
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: t('title'), text: t('text'), url: link });
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return;
        }
      }
      await copy(link);
    } catch (error) {
      notify.error(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
      <Button variant="outline" size="lg" fullWidth leadingIcon={<Share2 aria-hidden="true" />} loading={share.isPending} onClick={() => void onShare()}>
        {t('button')}
      </Button>
      <p className="text-sm text-muted-foreground">{t('hint')}</p>
      {url ? (
        <div className="flex items-end gap-2">
          <FormField label={t('linkLabel')} id={inputId} className="min-w-0 flex-1">
            <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} data-testid="sos-share-url" />
          </FormField>
          <Button variant="secondary" leadingIcon={<Copy aria-hidden="true" />} onClick={() => void copy(url)}>
            {t('copy')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function EndedPanel({ sos }: { sos: SosDto }) {
  const t = useTranslations('sos.live.ended');
  const base = sos.status === 'closed' || sos.status === 'cancelled' || sos.status === 'expired' ? sos.status : 'closed';
  // Expired after a helper had accepted = the 24 h timeout, not "nobody came".
  const status = base === 'expired' && sos.responses.some((r) => r.status === 'accepted' || r.status === 'arrived') ? 'timedOut' : base;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-5" data-testid="sos-ended" role="status">
      <p className="text-lg font-semibold">{t(`${status}.title`)}</p>
      <p className="text-[0.9375rem] text-muted-foreground text-pretty">{t(`${status}.body`)}</p>
      <div className="flex flex-wrap gap-2">
        {status === 'cancelled' || status === 'expired' ? (
          <Button asChild>
            <Link href="/sos">{t('again')}</Link>
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link href="/sos/history">{t('history')}</Link>
        </Button>
      </div>
    </div>
  );
}

/* ---------- helper / viewer ---------- */

function HelperLive({ sos, onReload }: { sos: SosDto; onReload: () => void }) {
  const t = useTranslations('sos');
  const format = useFormatter();
  const view = helperView(sos);
  const online = useOnlineStatus();
  const respond = useRespondSos(sos.id);
  const withdraw = useWithdrawSos(sos.id);
  const arrived = useArrivedSos(sos.id);
  const openDirect = useOpenDirectChat();
  const [error, setError] = useState<unknown>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const name = sos.requester.name || `@${sos.requester.nickname}`;
  const firstName = name.split(/\s+/)[0] ?? name;

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setError(null);
    try {
      await fn();
      notify.success(success);
    } catch (err) {
      setError(err);
      throw err;
    }
  };

  const messageButton =
    view.message?.kind === 'sos_chat' ? (
      <Button asChild size="lg" variant="secondary" fullWidth leadingIcon={<MessageCircle aria-hidden="true" />}>
        <Link href={`/chats/${view.message.chatId}`}>{t('helper.sosChat')}</Link>
      </Button>
    ) : view.message?.kind === 'direct' ? (
      <Button
        size="lg"
        variant="secondary"
        fullWidth
        leadingIcon={<MessageCircle aria-hidden="true" />}
        loading={openDirect.isPending}
        disabled={!online}
        onClick={() => openDirect.mutate(sos.requester.id)}
      >
        {t('helper.message')}
      </Button>
    ) : null;

  const callButton = view.callPhone ? (
    <Button asChild size="lg" variant="outline" fullWidth leadingIcon={<Phone aria-hidden="true" />}>
      <a href={telHref(view.callPhone)} data-testid="sos-call" aria-label={`${t('helper.call')}: ${formatPhone(view.callPhone)}`}>
        {t('helper.call')}
      </a>
    </Button>
  ) : null;

  const navigateButton = view.canNavigate ? (
    <Button asChild size="lg" variant="outline" fullWidth leadingIcon={<Navigation aria-hidden="true" />}>
      <a href={navigateUrl(sos.lat, sos.lng)} target="_blank" rel="noopener noreferrer">
        {t('helper.navigate')}
      </a>
    </Button>
  ) : null;

  let panel: ReactNode;
  switch (view.state) {
    case 'can_offer':
      panel = (
        <div className="flex flex-col gap-2" data-testid="sos-helper-panel" data-state={view.state}>
          <Button
            size="xl"
            fullWidth
            leadingIcon={<HelpIcon />}
            loading={respond.isPending}
            disabled={!online}
            onClick={() => void run(() => respond.mutateAsync(undefined), t('helper.offerToast')).catch(() => undefined)}
            data-testid="sos-help"
          >
            {t('helper.help')}
          </Button>
          <p className="text-center text-sm text-muted-foreground">{t('helper.helpHint')}</p>
          <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
            {callButton}
            {messageButton}
          </div>
          {view.callPhone ? null : <p className="text-sm text-muted-foreground">{t('helper.phoneHidden')}</p>}
        </div>
      );
      break;
    case 'offered':
      panel = (
        <div className="flex flex-col gap-3" data-testid="sos-helper-panel" data-state={view.state}>
          <StatePanel tone="info" title={t('helper.offered.title')} body={t('helper.offered.body', { name: firstName })} />
          <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
            {callButton}
            {messageButton}
          </div>
          <Button variant="ghost" onClick={() => setConfirmWithdraw(true)} disabled={!online} className="self-center">
            {t('helper.withdraw')}
          </Button>
        </div>
      );
      break;
    case 'accepted':
    case 'arrived':
      panel = (
        <div className="flex flex-col gap-3" data-testid="sos-helper-panel" data-state={view.state}>
          <StatePanel
            tone="success"
            title={view.state === 'accepted' ? t('helper.accepted.title', { name: firstName }) : t('helper.arrivedState.title')}
            body={view.state === 'accepted' ? t('helper.accepted.body') : t('helper.arrivedState.body')}
          />
          {view.callPhone ? (
            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">{t('helper.requesterPhone')}</span>
              <PhoneLink phone={view.callPhone} label={t('helper.call')} />
            </div>
          ) : null}
          {view.canMarkArrived ? (
            <Button
              size="xl"
              fullWidth
              leadingIcon={<UserCheck aria-hidden="true" />}
              loading={arrived.isPending}
              disabled={!online}
              onClick={() => void run(() => arrived.mutateAsync(undefined), t('helper.arrivedToast')).catch(() => undefined)}
              data-testid="sos-arrived"
            >
              {t('helper.arrived')}
            </Button>
          ) : null}
          <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
            {navigateButton}
            {messageButton}
          </div>
          {view.canWithdraw ? (
            <Button variant="ghost" onClick={() => setConfirmWithdraw(true)} disabled={!online} className="self-center">
              {t('helper.withdraw')}
            </Button>
          ) : null}
        </div>
      );
      break;
    case 'declined':
      panel = <StatePanel tone="muted" title={t('helper.declined.title', { name: firstName })} body={t('helper.declined.body')} testId="sos-helper-panel" state={view.state} />;
      break;
    case 'unavailable':
      panel = <StatePanel tone="muted" title={t('helper.unavailable.title')} body={t('helper.unavailable.body')} testId="sos-helper-panel" state={view.state} />;
      break;
    case 'ended':
      panel = (
        <StatePanel
          tone={sos.status === 'closed' ? 'success' : 'muted'}
          title={t(`helper.ended.${sos.status === 'closed' || sos.status === 'cancelled' || sos.status === 'expired' ? sos.status : 'closed'}`)}
          body={sos.closedAt ? t('helper.endedAt', { time: format.dateTime(new Date(sos.closedAt), { dateStyle: 'medium', timeStyle: 'short' }) }) : ''}
          testId="sos-helper-panel"
          state={view.state}
        />
      );
      break;
  }

  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-6" data-testid="sos-live" data-role={sos.myRole} data-status={sos.status}>
      <PageHeader title={t('helper.title', { name: firstName })} back="/sos/nearby" />
      {sos.type === 'accident' && view.open ? <EmergencyCallButton /> : null}

      <SosHero sos={sos}>
        <PersonSummary user={sos.requester} />
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">{t('card.description')}</span>
          <p className="whitespace-pre-line break-words text-[0.9375rem]" data-testid="sos-description">
            {sos.description || <span className="text-muted-foreground">{t('card.noDescription')}</span>}
          </p>
        </div>
        <SosPhotos photos={sos.photos} name={t(`types.${sos.type}`)} />
      </SosHero>

      {error ? (
        <SosGuidanceNotice
          error={error}
          context="help"
          onAction={(kind) => {
            if (kind === 'reload') {
              setError(null);
              onReload();
            }
          }}
        />
      ) : null}

      {panel}
      <ReviewPrompt sos={sos} />

      <Section title={t('card.location')}>
        <SosMap value={{ lat: sos.lat, lng: sos.lng }} label={t('card.mapLabel')} className="h-48 sm:h-56" zoom={15} />
        <a href={osmUrl(sos.lat, sos.lng)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 self-start text-sm font-medium text-primary underline-offset-4 hover:underline focus-ring rounded-sm">
          <MapPin aria-hidden="true" className="size-4" />
          {t('card.openInMaps')}
        </a>
      </Section>

      <Card className="p-4 sm:p-5">
        <SosTimeline steps={timelineSteps(sos)} />
      </Card>

      <SosEmergencyFooter />

      <div className="flex justify-center">
        <ReportButton target={{ type: 'sos', id: sos.id }} label={t('helper.report')} size="sm" />
      </div>

      <ConfirmDialog
        open={confirmWithdraw}
        onOpenChange={setConfirmWithdraw}
        title={t('helper.withdrawConfirm.title')}
        description={t('helper.withdrawConfirm.description', { name: firstName })}
        confirmLabel={t('helper.withdrawConfirm.confirm')}
        onConfirm={() => run(() => withdraw.mutateAsync(undefined), t('helper.withdrawToast'))}
      />
    </div>
  );
}

function HelpIcon() {
  return <Check aria-hidden="true" />;
}

function StatePanel({
  tone,
  title,
  body,
  testId,
  state,
}: {
  tone: 'info' | 'success' | 'muted';
  title: string;
  body: string;
  testId?: string;
  state?: string;
}) {
  return (
    <div
      role="status"
      data-testid={testId}
      data-state={state}
      className={cn(
        'flex flex-col gap-1 rounded-2xl border p-4',
        tone === 'info' && 'border-primary/30 bg-primary-soft text-primary-soft-foreground',
        tone === 'success' && 'border-success/40 bg-success-soft text-success-soft-foreground',
        tone === 'muted' && 'bg-card',
      )}
    >
      <p className="font-semibold">{title}</p>
      {body ? <p className={cn('text-sm text-pretty', tone === 'muted' && 'text-muted-foreground')}>{body}</p> : null}
    </div>
  );
}

/**
 * After a closed SOS: "How did it go?" with one button per person the viewer can still review
 * (`reviewTargets`). The sheet opens by itself once per SOS per tab, so both sides get the prompt.
 */
function ReviewPrompt({ sos }: { sos: SosDto }) {
  const t = useTranslations('rating.review');
  const [target, setTarget] = useState<SosDto['reviewTargets'][number] | null>(null);
  const targets = sos.canReview ? (sos.reviewTargets ?? []) : [];
  const first = targets[0] ?? null;

  const key = `autoc:review-prompted:${sos.id}`;
  const firstId = first?.id ?? null;
  useEffect(() => {
    if (!firstId) return;
    try {
      if (window.sessionStorage.getItem(key)) return;
    } catch {
      // Storage blocked: prompt anyway (the card stays as the fallback).
    }
    setTarget(targets.find((u) => u.id === firstId) ?? null);
    // Only when the first target changes; `targets` is a fresh array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstId, key]);
  /** Remembered once the driver closed the sheet (sent or "Later"), so it doesn't pop up again in this tab. */
  const closeSheet = () => {
    try {
      window.sessionStorage.setItem(key, '1');
    } catch {
      // ignore
    }
    setTarget(null);
  };

  if (targets.length === 0) return null;
  const role = sos.myRole === 'requester' ? 'helper' : 'requester';
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary-soft p-4 text-primary-soft-foreground" data-testid="review-prompt">
      <div className="flex flex-col gap-1">
        <p className="font-semibold">{t('promptTitle')}</p>
        <p className="text-sm text-pretty">{role === 'helper' ? t('promptHelpers') : t('promptRequester')}</p>
      </div>
      <ul className="flex flex-col gap-2">
        {targets.map((user) => (
          <li key={user.id}>
            <Button variant="outline" className="bg-card" fullWidth onClick={() => setTarget(user)}>
              {t('rate', { name: user.name || `@${user.nickname}` })}
            </Button>
          </li>
        ))}
      </ul>
      <ReviewSheet sosId={sos.id} target={target} role={role} open={target !== null} onOpenChange={(open) => (open ? undefined : closeSheet())} />
    </section>
  );
}
