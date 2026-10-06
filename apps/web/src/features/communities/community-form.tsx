'use client';

import {
  citySchema,
  COMMUNITY_LIMITS,
  communityDescriptionSchema,
  communityNameSchema,
  type CommunityDto,
} from '@autoc/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Globe, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useId, useState, type ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { useErrorMessage } from '@/hooks/use-error-message';
import { applyApiError } from '@/lib/forms/apply-api-error';
import { PremiumLimitHint } from '@/features/premium/limit-hint';
import { fieldErrorText } from '@/lib/forms/field-error';
import { useZodErrorMap } from '@/lib/forms/zod-error-map';
import { AvatarPicker, type AvatarValue } from '@/features/profile/avatar-picker';
import { CitySelect } from '@/features/profile/profile-form';

export const communityFormSchema = z.object({
  name: communityNameSchema,
  description: communityDescriptionSchema,
  city: citySchema.nullable(),
  isPrivate: z.boolean(),
});

export type CommunityFormInput = z.input<typeof communityFormSchema>;
export type CommunityFormOutput = z.output<typeof communityFormSchema>;
export type CommunityFormSubmit = CommunityFormOutput & { avatarUploadId?: string | null };

/** Which fields the viewer may change (API.md §3: city and privacy are owner-only). */
export type CommunityFormMode = 'create' | 'owner' | 'moderator';

type Props = {
  /** Stable id for the avatar fallback colour (the community id, or a draft id). */
  avatarId: string;
  initial?: Pick<CommunityDto, 'name' | 'description' | 'city' | 'isPrivate' | 'avatarUrl'>;
  mode: CommunityFormMode;
  /** Must throw on failure; server errors are mapped onto fields. */
  onSubmit: (values: CommunityFormSubmit, dirty: Partial<Record<keyof CommunityFormInput | 'avatar', boolean>>) => Promise<unknown>;
  /** Renders the submit area; receives `busy` (avatar uploading). */
  footer: (state: { busy: boolean; submitting: boolean }) => ReactNode;
  formId?: string;
};

/** Name, description, city, privacy and picture — the create page and the settings sheet. */
export function CommunityForm({ avatarId, initial, mode, onSubmit, footer, formId }: Props) {
  const t = useTranslations('communities.form');
  const errorMessage = useErrorMessage();
  const privacyId = useId();
  const [avatar, setAvatar] = useState<AvatarValue>({ url: initial?.avatarUrl ?? null });
  const [uploading, setUploading] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const onBusyChange = useCallback((busy: boolean) => setUploading(busy), []);
  const ownerFields = mode !== 'moderator';

  const form = useForm<CommunityFormInput, unknown, CommunityFormOutput>({
    resolver: zodResolver(communityFormSchema, { error: useZodErrorMap() }),
    defaultValues: {
      name: initial?.name ?? '',
      description: initial?.description ?? '',
      city: (initial?.city as CommunityFormInput['city']) ?? null,
      isPrivate: initial?.isPrivate ?? false,
    },
    mode: 'onTouched',
  });
  const { errors, isSubmitting, dirtyFields } = form.formState;
  const invalidChars = t('invalidChars');

  const submit = form.handleSubmit(async (values) => {
    try {
      await onSubmit(
        { ...values, avatarUploadId: avatar.uploadId },
        { ...dirtyFields, avatar: avatar.uploadId !== undefined } as Partial<Record<keyof CommunityFormInput | 'avatar', boolean>>,
      );
    } catch (error) {
      setSubmitError(error);
      applyApiError(form, error, errorMessage(error), { fieldByCode: { COMMUNITY_NAME_TAKEN: 'name' } });
    }
  });

  return (
    <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label>{t('avatar')}</Label>
        <AvatarPicker
          userId={avatarId}
          name={form.watch('name') || '?'}
          value={avatar}
          onChange={setAvatar}
          onBusyChange={onBusyChange}
          purpose="community"
          shape="square"
        />
      </div>

      <FormField
        label={t('name')}
        required
        hint={t('nameHint', { min: COMMUNITY_LIMITS.nameMin, max: COMMUNITY_LIMITS.nameMax })}
        error={fieldErrorText(errors.name, { custom: invalidChars })}
      >
        <Input {...form.register('name')} maxLength={COMMUNITY_LIMITS.nameMax} autoComplete="off" enterKeyHint="next" />
      </FormField>

      <Controller
        name="description"
        control={form.control}
        render={({ field, fieldState }) => (
          <FormField label={t('description')} error={fieldErrorText(fieldState.error, { custom: invalidChars })}>
            <Textarea
              ref={field.ref}
              name={field.name}
              value={field.value ?? ''}
              onChange={field.onChange}
              onBlur={field.onBlur}
              placeholder={t('descriptionPlaceholder')}
              maxLength={COMMUNITY_LIMITS.descriptionMax}
              showCount
            />
          </FormField>
        )}
      />

      {ownerFields ? (
        <>
          <Controller
            name="city"
            control={form.control}
            render={({ field, fieldState }) => (
              <FormField label={t('city')} error={fieldErrorText(fieldState.error)}>
                <CitySelect value={field.value ?? null} onChange={field.onChange} onBlur={field.onBlur} triggerRef={field.ref} />
              </FormField>
            )}
          />

          <Controller
            name="isPrivate"
            control={form.control}
            render={({ field }) => (
              <div className="flex flex-col gap-1.5">
                <Label id={privacyId}>{t('privacy')}</Label>
                <RadioGroup
                  aria-labelledby={privacyId}
                  value={field.value ? 'private' : 'public'}
                  onValueChange={(value) => field.onChange(value === 'private')}
                >
                  <RadioCard value="public" icon={Globe} title={t('publicTitle')} description={t('publicDescription')} />
                  <RadioCard value="private" icon={Lock} title={t('privateTitle')} description={t('privateDescription')} />
                </RadioGroup>
              </div>
            )}
          />
        </>
      ) : (
        <p className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">{t('moderatorNote')}</p>
      )}

      {errors.root?.server ? (
        <p role="alert" className="text-sm text-danger">
          {errors.root.server.message}
        </p>
      ) : null}
      {errors.root?.server ? <PremiumLimitHint error={submitError} /> : null}

      {footer({ busy: uploading, submitting: isSubmitting })}
    </form>
  );
}
