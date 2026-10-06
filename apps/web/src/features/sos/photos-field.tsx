'use client';

import { LIMITS, SOS_LIMITS } from '@autoc/shared';
import { useMutation } from '@tanstack/react-query';
import { ImagePlus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { FormError } from '@/components/ui/form-error';
import { IconButton } from '@/components/ui/icon-button';
import { Spinner } from '@/components/ui/spinner';
import { useErrorMessage } from '@/hooks/use-error-message';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/errors';

const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
export type SosPhoto = { id: string; url: string };

/** Up to 4 photos, uploaded right away with purpose `sos`; the SOS is created with their ids. */
export function SosPhotosField({
  value,
  onChange,
  onBusyChange,
  describedBy,
}: {
  value: SosPhoto[];
  onChange: (v: SosPhoto[]) => void;
  onBusyChange?: (busy: boolean) => void;
  describedBy?: string;
}) {
  const t = useTranslations('sos.request');
  const errorMessage = useErrorMessage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const upload = useMutation({ mutationFn: (file: File) => api.uploads.create(file, 'sos') });
  useEffect(() => onBusyChange?.(upload.isPending), [upload.isPending, onBusyChange]);

  const add = async (files: FileList | null) => {
    setError(null);
    const room = SOS_LIMITS.photosMax - value.length;
    let next = value;
    for (const file of Array.from(files ?? []).slice(0, room)) {
      if (file.type && !TYPES.includes(file.type)) {
        setError(errorMessage(new ApiError({ status: 415, code: 'UNSUPPORTED_FILE_TYPE', message: '' })));
        continue;
      }
      if (file.size > LIMITS.imageMaxBytes) {
        setError(errorMessage(new ApiError({ status: 413, code: 'FILE_TOO_LARGE', message: '' })));
        continue;
      }
      try {
        const res = await upload.mutateAsync(file);
        next = [...next, { id: res.id, url: res.thumbUrl ?? res.url }];
        onChange(next);
      } catch (err) {
        setError(errorMessage(err));
      }
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <ul className="grid grid-cols-4 gap-2" aria-label={t('photos')}>
        {value.map((p, i) => (
          <li key={p.id} className="relative aspect-square overflow-hidden rounded-xl border bg-muted" data-testid="sos-photo-draft">
            {/* eslint-disable-next-line @next/next/no-img-element -- uploaded media */}
            <img src={p.url} alt={t('photoAlt', { index: i + 1 })} className="size-full object-cover" />
            <IconButton
              aria-label={t('removePhoto', { index: i + 1 })}
              size="sm"
              variant="secondary"
              className="absolute end-0.5 top-0.5 shadow-sm"
              onClick={() => onChange(value.filter((x) => x.id !== p.id))}
            >
              <X />
            </IconButton>
          </li>
        ))}
        {value.length < SOS_LIMITS.photosMax ? (
          <li className="aspect-square">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={upload.isPending}
              aria-describedby={describedBy}
              className="flex size-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-input bg-card p-1 text-center text-sm text-muted-foreground focus-ring hover:bg-accent disabled:cursor-progress"
            >
              {upload.isPending ? <Spinner size="sm" label={t('uploading')} /> : <ImagePlus aria-hidden="true" className="size-6" />}
              <span className="leading-tight">{t('addPhoto')}</span>
            </button>
          </li>
        ) : null}
      </ul>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={TYPES.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="sos-photo-input"
        onChange={(e) => {
          void add(e.target.files).finally(() => {
            if (inputRef.current) inputRef.current.value = '';
          });
        }}
      />
      <FormError>{error}</FormError>
    </div>
  );
}
