'use client';

import { LIMITS, type UploadPurpose } from '@autoc/shared';
import { useMutation } from '@tanstack/react-query';
import { Camera, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useErrorMessage } from '@/hooks/use-error-message';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

/** `uploadId`: undefined = unchanged, null = remove, string = new upload. */
export type AvatarValue = { uploadId?: string | null; url: string | null };

/** Rejects files the API would refuse anyway, before spending the upload. */
export function validateAvatarFile(file: Pick<File, 'type' | 'size'>): ApiError | null {
  if (file.type && !ACCEPTED_TYPES.includes(file.type)) {
    return new ApiError({ status: 415, code: 'UNSUPPORTED_FILE_TYPE', message: 'Unsupported file type' });
  }
  if (file.size > LIMITS.imageMaxBytes) {
    return new ApiError({ status: 413, code: 'FILE_TOO_LARGE', message: 'File is too large' });
  }
  return null;
}

type Props = {
  userId: string;
  name: string;
  value: AvatarValue;
  onChange: (value: AvatarValue) => void;
  /** Reports whether an upload is running, so the parent can hold its submit. */
  onBusyChange?: (busy: boolean) => void;
  /** Upload purpose (`community` for community pictures). */
  purpose?: UploadPurpose;
  /** Communities use square avatars. */
  shape?: 'circle' | 'square';
};

/** Avatar with upload (immediate, to POST /uploads) and remove. Shows a local preview while uploading. */
export function AvatarPicker({ userId, name, value, onChange, onBusyChange, purpose = 'avatar', shape = 'circle' }: Props) {
  const t = useTranslations('profile.avatar');
  const errorMessage = useErrorMessage();
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({ mutationFn: (file: File) => api.uploads.create(file, purpose) });

  useEffect(() => onBusyChange?.(upload.isPending), [upload.isPending, onBusyChange]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    const invalid = validateAvatarFile(file);
    if (invalid) {
      setError(errorMessage(invalid));
      return;
    }
    setPreview(URL.createObjectURL(file));
    try {
      const result = await upload.mutateAsync(file);
      onChange({ uploadId: result.id, url: result.thumbUrl ?? result.url });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPreview(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const shown = preview ?? value.url;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-4">
        <div className="relative">
          <Avatar id={userId} name={name || '?'} src={shown} size="xl" shape={shape} decorative />
          {upload.isPending ? (
            <span
              className={cn(
                'absolute inset-0 flex items-center justify-center bg-overlay text-white',
                shape === 'square' ? 'rounded-2xl' : 'rounded-full',
              )}
            >
              <Spinner size="md" label={t('uploading')} />
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col items-start gap-1">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_TYPES.join(',')}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="avatar-input"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <Button
            variant="outline"
            size="sm"
            leadingIcon={<Camera aria-hidden="true" />}
            loading={upload.isPending}
            aria-describedby={error ? errorId : undefined}
            onClick={() => inputRef.current?.click()}
          >
            {shown ? t('change') : t('upload')}
          </Button>
          {shown && !upload.isPending ? (
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<Trash2 aria-hidden="true" />}
              onClick={() => {
                setError(null);
                onChange({ uploadId: null, url: null });
              }}
            >
              {t('remove')}
            </Button>
          ) : null}
          <p className="text-sm text-muted-foreground">{t('hint', { maxMb: LIMITS.imageMaxBytes / (1024 * 1024) })}</p>
        </div>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
