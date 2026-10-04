'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FormError } from '@/components/ui/form-error';
import { PageHeader } from '@/components/ui/page-header';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useCurrentUser } from '@/lib/auth/guards';
import { applyApiError } from '@/lib/forms/apply-api-error';
import { notify } from '@/lib/toast';
import { AvatarPicker, type AvatarValue } from './avatar-picker';
import { ProfileFields, profileDefaults, useProfileForm } from './profile-form';
import { useUpdateMe } from './queries';

export function EditProfileView() {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const me = useCurrentUser();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const form = useProfileForm(profileDefaults(me));
  const updateMe = useUpdateMe();
  const [avatar, setAvatar] = useState<AvatarValue>({ url: me.avatarUrl });
  const [uploading, setUploading] = useState(false);
  const name = form.watch('name');

  const submit = form.handleSubmit(async (values) => {
    try {
      await updateMe.mutateAsync({
        ...values,
        bio: values.bio ? values.bio : null,
        ...(avatar.uploadId !== undefined ? { avatarUploadId: avatar.uploadId } : {}),
      });
      notify.success(t('saved'));
      router.push('/profile');
    } catch (error) {
      applyApiError(form, error, errorMessage(error), { fieldByCode: { NICKNAME_TAKEN: 'nickname' } });
    }
  });

  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col">
      <PageHeader title={t('editTitle')} description={t('editDescription')} back="/profile" />
      <form onSubmit={submit} noValidate className="flex flex-col gap-6">
        <Card className="flex flex-col gap-6">
          <AvatarPicker userId={me.id} name={name} value={avatar} onChange={setAvatar} onBusyChange={setUploading} />
          <ProfileFields form={form} showBio />
        </Card>
        <FormError>{form.formState.errors.root?.server?.message}</FormError>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" size="lg" onClick={() => router.push('/profile')} disabled={form.formState.isSubmitting}>
            {tc('cancel')}
          </Button>
          <Button type="submit" size="lg" loading={form.formState.isSubmitting} disabled={uploading}>
            {tc('saveChanges')}
          </Button>
        </div>
      </form>
    </div>
  );
}
