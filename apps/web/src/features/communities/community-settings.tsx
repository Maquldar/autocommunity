'use client';

import type { CommunityDto, UpdateCommunityInput } from '@autoc/shared';
import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { notify } from '@/lib/toast';
import { CommunityForm } from './community-form';
import { MembersList } from './members-panel';
import { communityPermissions } from './membership-state';
import { useDeleteCommunity, useUpdateCommunity } from './queries';

/**
 * Settings for moderators and the owner: edit details (per their rights), manage member roles, and
 * (owner) delete the community. A bottom sheet on phones, a right panel on desktop.
 */
export function CommunitySettingsSheet({
  community,
  open,
  onOpenChange,
}: {
  community: CommunityDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('communities.settings');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="lg:w-[30rem]" data-testid="community-settings">
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        {open ? <SettingsBody community={community} onDone={() => onOpenChange(false)} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h3 id={id} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

function SettingsBody({ community, onDone }: { community: CommunityDto; onDone: () => void }) {
  const t = useTranslations('communities');
  const router = useRouter();
  const online = useOnlineStatus();
  const errorMessage = useErrorMessage();
  const permissions = communityPermissions(community);
  const update = useUpdateCommunity(community.id);
  const remove = useDeleteCommunity(community.id);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="settings-details" className="flex flex-col gap-3">
        <SectionHeading id="settings-details">{t('settings.details')}</SectionHeading>
        <CommunityForm
          avatarId={community.id}
          initial={community}
          mode={permissions.isOwner ? 'owner' : 'moderator'}
          onSubmit={async (values, dirty) => {
            const input: UpdateCommunityInput = {};
            if (dirty.name) input.name = values.name;
            if (dirty.description) input.description = values.description;
            if (dirty.avatar) input.avatarUploadId = values.avatarUploadId ?? null;
            if (permissions.isOwner) {
              if (dirty.city) input.city = values.city;
              if (dirty.isPrivate) input.isPrivate = values.isPrivate;
            }
            if (Object.keys(input).length > 0) await update.mutateAsync(input);
            notify.success(t('toasts.saved'));
            onDone();
          }}
          footer={({ busy, submitting }) => (
            <Button type="submit" fullWidth size="lg" loading={submitting} disabled={busy || !online}>
              {t('settings.save')}
            </Button>
          )}
        />
      </section>

      <section aria-labelledby="settings-members" className="flex flex-col gap-3">
        <SectionHeading id="settings-members">{t('settings.membersSection')}</SectionHeading>
        <p className="text-sm text-muted-foreground">{permissions.isOwner ? t('settings.membersHintOwner') : t('settings.membersHintModerator')}</p>
        <MembersList community={community} compact />
      </section>

      {permissions.canDelete ? (
        <section aria-labelledby="settings-danger" className="flex flex-col gap-3 rounded-2xl border border-danger/40 p-4">
          <SectionHeading id="settings-danger">{t('settings.danger')}</SectionHeading>
          <p className="text-sm text-muted-foreground">{t('settings.deleteHint')}</p>
          <Button variant="danger" leadingIcon={<Trash2 aria-hidden="true" />} disabled={!online} onClick={() => setConfirmDelete(true)}>
            {t('confirm.deleteConfirm')}
          </Button>
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            tone="danger"
            title={t('confirm.deleteTitle', { name: community.name })}
            description={t('confirm.deleteDescription')}
            confirmLabel={t('confirm.deleteConfirm')}
            onConfirm={async () => {
              try {
                await remove.mutateAsync();
              } catch (error) {
                notify.error(errorMessage(error));
                throw error;
              }
              notify.success(t('toasts.deleted'));
              onDone();
              router.replace('/communities');
            }}
          />
        </section>
      ) : null}
    </div>
  );
}
