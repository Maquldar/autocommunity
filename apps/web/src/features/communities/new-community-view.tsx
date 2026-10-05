'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { notify } from '@/lib/toast';
import { CommunityForm } from './community-form';
import { useCreateCommunity } from './queries';

/** /communities/new — create a community; the creator becomes its owner. */
export function NewCommunityView() {
  const t = useTranslations('communities');
  const router = useRouter();
  const online = useOnlineStatus();
  const create = useCreateCommunity();
  // Fallback colour for the picture preview before the community has an id.
  const [draftId] = useState(() => `draft-${Math.random().toString(36).slice(2)}`);

  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-2">
      <PageHeader back="/communities" title={t('new.title')} description={t('new.description')} />
      <div className="rounded-2xl border bg-card p-4 sm:p-5">
        <CommunityForm
          avatarId={draftId}
          mode="create"
          onSubmit={async (values) => {
            const community = await create.mutateAsync({
              name: values.name,
              description: values.description,
              city: values.city,
              isPrivate: values.isPrivate,
              avatarUploadId: values.avatarUploadId ?? undefined,
            });
            notify.success(t('toasts.created'));
            router.replace(`/communities/${community.id}`);
          }}
          footer={({ busy, submitting }) => (
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" size="lg" onClick={() => router.push('/communities')}>
                {t('form.cancel')}
              </Button>
              <Button type="submit" size="lg" loading={submitting} disabled={busy || !online} className="max-sm:w-full">
                {t('form.submit')}
              </Button>
            </div>
          )}
        />
      </div>
    </div>
  );
}
