'use client';

import type { UploadDto } from '@autoc/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { IconButton } from '@/components/ui/icon-button';

/** Horizontal strip of photos (scroll-snap); tapping one opens it full-size with previous/next. */
export function PhotoGallery({ photos, name }: { photos: UploadDto[]; name: string }) {
  const t = useTranslations('services.details');
  const tc = useTranslations('common');
  const [open, setOpen] = useState<number | null>(null);
  if (photos.length === 0) return null;
  const current = open === null ? null : photos[open];
  const go = (delta: number) => setOpen((i) => (i === null ? i : (i + delta + photos.length) % photos.length));

  return (
    <section aria-label={t('photos')}>
      <ul className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:thin] sm:-mx-6 sm:px-6">
        {photos.map((p, i) => (
          <li key={p.id} className="shrink-0 snap-start">
            <button
              type="button"
              onClick={() => setOpen(i)}
              className="block overflow-hidden rounded-2xl border bg-muted focus-ring"
              aria-label={t('openPhoto', { index: i + 1 })}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- user media from the API host */}
              <img
                src={p.thumbUrl ?? p.url}
                alt=""
                loading={i === 0 ? 'eager' : 'lazy'}
                className="h-44 w-64 object-cover sm:h-52 sm:w-80"
                width={p.width ?? undefined}
                height={p.height ?? undefined}
              />
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
