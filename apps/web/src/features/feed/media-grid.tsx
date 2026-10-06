'use client';

import type { UploadDto } from '@autoc/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/cn';

const isVideo = (u: UploadDto) => u.mime.startsWith('video/');

/** Photos in a 1–6 grid (tap opens a lightbox with prev / next), or one video player. */
export function MediaGrid({ media, label }: { media: UploadDto[]; label: string }) {
  const t = useTranslations('feed.media');
  const [open, setOpen] = useState<number | null>(null);
  if (!media.length) return null;
  const video = media.find(isVideo);
  if (video) {
    return (
      <video
        controls
        preload="metadata"
        playsInline
        src={video.url}
        aria-label={t('video')}
        className="max-h-[70vh] w-full rounded-xl border bg-black"
        style={video.width && video.height ? { aspectRatio: `${video.width} / ${video.height}` } : undefined}
        data-testid="post-video"
      />
    );
  }
  const count = media.length;
  const cols = count === 1 ? 'grid-cols-1' : count <= 4 ? 'grid-cols-2' : 'grid-cols-3';
  const current = open === null ? null : media[open];
  return (
    <>
      <ul className={cn('grid gap-1 overflow-hidden rounded-xl', cols)} aria-label={label} data-testid="post-media">
        {media.map((m, i) => (
          <li key={m.id} className={cn(count === 3 && i === 0 && 'col-span-2')}>
            <button
              type="button"
              onClick={() => setOpen(i)}
              aria-label={t('open', { index: i + 1, count })}
              className="block w-full overflow-hidden bg-muted focus-ring"
              style={{ aspectRatio: count === 1 && m.width && m.height ? `${m.width} / ${m.height}` : count === 3 && i === 0 ? '2 / 1' : '1 / 1' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- uploaded media */}
              <img src={count === 1 ? m.url : (m.thumbUrl ?? m.url)} alt="" loading="lazy" className="size-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-4xl gap-3 p-3 sm:p-4" data-testid="lightbox">
          <DialogTitle className="pe-10 text-base">{t('counter', { index: (open ?? 0) + 1, count })}</DialogTitle>
          {current ? (
            <div className="relative flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- uploaded media */}
              <img src={current.url} alt={t('photo', { index: (open ?? 0) + 1, count })} className="max-h-[75vh] w-auto max-w-full rounded-lg object-contain" />
              {count > 1 ? (
                <>
                  <IconButton aria-label={t('previous')} variant="secondary" className="absolute start-1 top-1/2 -translate-y-1/2 shadow" onClick={() => setOpen(((open ?? 0) + count - 1) % count)}>
                    <ChevronLeft className="rtl:rotate-180" />
                  </IconButton>
                  <IconButton aria-label={t('next')} variant="secondary" className="absolute end-1 top-1/2 -translate-y-1/2 shadow" onClick={() => setOpen(((open ?? 0) + 1) % count)}>
                    <ChevronRight className="rtl:rotate-180" />
                  </IconButton>
                </>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
