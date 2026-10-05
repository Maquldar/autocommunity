'use client';

import type { MessageDto } from '@autoc/shared';
import { ExternalLink, MapPin, Pause, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/cn';
import { formatDuration, mapsUrl } from './format';

/** Photo: a thumbnail sized by the upload's aspect ratio (no layout shift), opening a full-size viewer. */
export function PhotoContent({ message, mine }: { message: MessageDto; mine: boolean }) {
  const t = useTranslations('chats.message');
  const [open, setOpen] = useState(false);
  const upload = message.upload;
  if (!upload) return null;
  const ratio = upload.width && upload.height ? upload.width / upload.height : 4 / 3;
  // Clamp very tall or very wide photos so the bubble stays readable.
  const aspect = Math.min(2, Math.max(0.6, ratio));
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('openPhoto')}
        className={cn('block w-64 max-w-full overflow-hidden rounded-xl bg-muted focus-ring', mine && 'focus-visible:outline-primary-foreground')}
        style={{ aspectRatio: String(aspect) }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- user media from the API host */}
        <img src={upload.thumbUrl ?? upload.url} alt="" loading="lazy" decoding="async" className="size-full object-cover" data-testid="message-photo" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[min(96vw,64rem)] p-2 sm:p-3">
          <DialogTitle className="sr-only">{t('photo')}</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element -- user media from the API host */}
          <img src={upload.url} alt={message.text ?? ''} className="max-h-[80dvh] w-full rounded-xl object-contain" />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Location: a map-like tile with the coordinates and an "Open in maps" link. */
export function LocationContent({ message }: { message: MessageDto }) {
  const t = useTranslations('chats.message');
  if (message.lat === null || message.lng === null) return null;
  return (
    <div className="flex w-64 max-w-full flex-col overflow-hidden rounded-xl border bg-card text-card-foreground" data-testid="message-location">
      <div aria-hidden="true" className="location-tile relative flex h-24 items-center justify-center bg-muted">
        <span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
          <MapPin className="size-5" />
        </span>
      </div>
      <div className="flex flex-col gap-1 px-3 py-2">
        <span className="text-sm font-medium">{t('location')}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {message.lat.toFixed(5)}, {message.lng.toFixed(5)}
        </span>
        <a
          href={mapsUrl(message.lat, message.lng)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline focus-ring rounded-md"
        >
          <ExternalLink aria-hidden="true" className="size-4" />
          {t('openInMaps')}
        </a>
      </div>
    </div>
  );
}

/** Voice: play/pause, a seek slider and the time, over a real <audio> element. */
export function VoiceContent({ message, mine }: { message: MessageDto; mine: boolean }) {
  const t = useTranslations('chats.message');
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(message.upload?.durationSec ?? 0);
  const upload = message.upload;

  useEffect(() => {
    const audio = audioRef.current;
    return () => audio?.pause();
  }, []);

  if (!upload) return null;

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      // Only one voice message plays at a time.
      document.querySelectorAll<HTMLAudioElement>('audio[data-voice]').forEach((other) => {
        if (other !== audio) other.pause();
      });
      void audio.play().catch(() => setPlaying(false));
    } else audio.pause();
  };

  const max = Math.max(duration, 0.1);
  return (
    <div className="flex w-60 max-w-full items-center gap-2" data-testid="message-voice">
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t('pause') : t('play')}
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full focus-ring',
          mine ? 'bg-primary-foreground text-primary' : 'bg-primary text-primary-foreground',
        )}
      >
        {playing ? <Pause aria-hidden="true" className="size-5" /> : <Play aria-hidden="true" className="size-5 translate-x-px" />}
      </button>
      <input
        type="range"
        min={0}
        max={max}
        step={0.1}
        value={Math.min(current, max)}
        onChange={(event) => {
          const value = Number(event.target.value);
          if (audioRef.current) audioRef.current.currentTime = value;
          setCurrent(value);
        }}
        aria-label={t('seek')}
        aria-valuetext={`${formatDuration(current)} / ${formatDuration(duration)}`}
        className={cn('h-11 min-w-0 flex-1 cursor-pointer', mine ? 'accent-primary-foreground' : 'accent-primary')}
      />
      <span className="w-10 shrink-0 text-end text-xs tabular-nums">{formatDuration(playing || current > 0 ? current : duration)}</span>
      <audio
        ref={audioRef}
        src={upload.url}
        preload="metadata"
        data-voice=""
        onLoadedMetadata={(event) => {
          const d = event.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        className="hidden"
      />
    </div>
  );
}
