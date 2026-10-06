'use client';

import type { EventDto } from '@autoc/shared';
import { Lock, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorMessage } from '@/hooks/use-error-message';
import { notify } from '@/lib/toast';
import { useCommunity } from '@/features/communities/queries';
import { useCreateEvent, useEvent, useUpdateEvent, type EventBody } from './api';
import { useEventErrorMessage } from './errors';
import { EventForm, initialValues } from './event-form';

function FormSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="mx-auto flex w-full max-w-narrow flex-col gap-4 pt-2">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-11 w-full rounded-lg" />
      <Skeleton className="h-11 w-full rounded-lg" />
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  );
}

function NoRights({ backHref }: { backHref: string }) {
  const t = useTranslations('events');
  return (
    <EmptyState
      icon={Lock}
      title={t('form.noRightsTitle')}
      description={t('form.noRightsDescription')}
      action={
        <Button asChild variant="secondary">
          <Link href={backHref}>{t('form.back')}</Link>
        </Button>
      }
    />
  );
}

/** /communities/[id]/events/new — owners and moderators only. */
export function NewEventView({ communityId }: { communityId: string }) {
  const t = useTranslations('events');
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const eventError = useEventErrorMessage();
  const community = useCommunity(communityId);
  const create = useCreateEvent(communityId);
  const [serverError, setServerError] = useState<string | null>(null);

  if (community.isPending) return <FormSkeleton label={t('loading')} />;
  if (community.isError) {
    return <ErrorState description={errorMessage(community.error)} onRetry={() => void community.refetch()} retrying={community.isFetching} />;
  }
  const m = community.data.myMembership;
  const back = `/communities/${communityId}?tab=events`;
  if (!(m?.status === 'active' && (m.role === 'owner' || m.role === 'moderator'))) return <NoRights backHref={back} />;

  const submit = (body: EventBody) => {
    setServerError(null);
    create.mutate(body, {
      onSuccess: (event) => {
        notify.success(t('form.created'));
        router.replace(`/events/${event.id}`);
      },
      onError: (error) => setServerError(eventError(error)),
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-2">
      <PageHeader back={back} title={t('form.createTitle')} description={community.data.name} />
      <EventForm initial={initialValues()} submitLabel={t('form.create')} pending={create.isPending} serverError={serverError} onSubmit={submit} onCancel={() => router.push(back)} />
    </div>
  );
}

/** Only the fields that changed (an unchanged past start time must not be re-validated as "in the future"). */
function diff(event: EventDto, body: EventBody): Partial<EventBody> {
  const out: Partial<EventBody> = {};
  if (body.title !== event.title) out.title = body.title;
  if (body.description !== event.description) out.description = body.description;
  if (body.place !== event.place) out.place = body.place;
  if (body.lat !== event.lat || body.lng !== event.lng) Object.assign(out, { lat: body.lat, lng: body.lng });
  if (new Date(body.startsAt).getTime() !== new Date(event.startsAt).getTime()) out.startsAt = body.startsAt;
  if ((body.endsAt ? new Date(body.endsAt).getTime() : null) !== (event.endsAt ? new Date(event.endsAt).getTime() : null)) out.endsAt = body.endsAt;
  if (JSON.stringify(body.route) !== JSON.stringify(event.route)) out.route = body.route;
  return out;
}

/** /events/[id]/edit — the creator and community moderators. */
export function EditEventView({ id }: { id: string }) {
  const t = useTranslations('events');
  const router = useRouter();
  const errorMessage = useEventErrorMessage();
  const query = useEvent(id);
  const update = useUpdateEvent(id);
  const [serverError, setServerError] = useState<string | null>(null);

  if (query.isPending) return <FormSkeleton label={t('loading')} />;
  if (query.isError) {
    return (
      <EmptyState
        icon={SearchX}
        title={t('notFound.title')}
        description={errorMessage(query.error)}
        action={
          <Button asChild>
            <Link href="/events">{t('notFound.back')}</Link>
          </Button>
        }
      />
    );
  }
  const event = query.data;
  if (!event.canManage) return <NoRights backHref={`/events/${id}`} />;

  const submit = (body: EventBody) => {
    setServerError(null);
    const changes = diff(event, body);
    if (!Object.keys(changes).length) {
      router.replace(`/events/${id}`);
      return;
    }
    update.mutate(changes, {
      onSuccess: () => {
        notify.success(t('form.saved'));
        router.replace(`/events/${id}`);
      },
      onError: (error) => setServerError(errorMessage(error)),
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-2">
      <PageHeader back={`/events/${id}`} title={t('form.editTitle')} description={event.community.name} />
      <EventForm
        initial={initialValues(event)}
        submitLabel={t('form.save')}
        pending={update.isPending}
        serverError={serverError}
        requireFuture={false}
        onSubmit={submit}
        onCancel={() => router.push(`/events/${id}`)}
      />
    </div>
  );
}
