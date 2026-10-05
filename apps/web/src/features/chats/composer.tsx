'use client';

import { CHAT_LIMITS, LIMITS } from '@autoc/shared';
import { ImageIcon, MapPin, Mic, Paperclip, SendHorizontal, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { IconButton } from '@/components/ui/icon-button';
import { Spinner } from '@/components/ui/spinner';
import { useErrorMessage } from '@/hooks/use-error-message';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import { validateAvatarFile } from '@/features/profile/avatar-picker';
import { formatDuration } from './format';
import type { Draft } from './outbox';
import { browserRecorderDeps, createVoiceRecorder, type RecordedVoice, type RecorderState, type VoiceRecorder } from './voice-recorder';

const COUNTER_FROM = Math.floor(CHAT_LIMITS.textMax * 0.8);
const MAX_TEXTAREA_PX = 160;

type PhotoDraft = { file: File; url: string; width: number | null; height: number | null };

function readImageSize(url: string): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || null, height: image.naturalHeight || null });
    image.onerror = () => resolve({ width: null, height: null });
    image.src = url;
  });
}

/** Voice recorder bound to React state; the recorder itself is a tested state machine. */
function useVoiceRecorder(onComplete: (voice: RecordedVoice) => void) {
  const [state, setState] = useState<RecorderState>({ status: 'idle' });
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  const get = useCallback(() => {
    recorderRef.current ??= createVoiceRecorder(browserRecorderDeps(), {
      onChange: setState,
      onComplete: (voice) => completeRef.current(voice),
    });
    return recorderRef.current;
  }, []);

  useEffect(() => () => recorderRef.current?.dispose(), []);

  return {
    state,
    start: () => void get().start(),
    stop: () => get().stop(),
    cancel: () => get().cancel(),
  };
}

export type ComposerProps = {
  disabled: boolean;
  onSend: (draft: Draft) => void;
  /** Called on each edit; the parent throttles `chat:typing`. */
  onTyping: () => void;
};

/**
 * Message composer: text (Enter sends, Shift+Enter breaks the line, 4000 max with a counter near the
 * limit), photo with preview and caption, current location (after a confirmation), and voice recording.
 */
export function Composer({ disabled, onSend, onTyping }: ComposerProps) {
  const t = useTranslations('chats.composer');
  const errorMessage = useErrorMessage();
  const inputId = useId();
  const counterId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<PhotoDraft | null>(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const [locating, setLocating] = useState(false);

  const recorder = useVoiceRecorder((voice) => onSend({ type: 'voice', file: voice.blob, durationSec: voice.durationSec }));
  const recording = recorder.state.status === 'recording' || recorder.state.status === 'requesting';

  useEffect(() => {
    if (recorder.state.status !== 'error') return;
    const key = recorder.state.error === 'denied' ? 'micDenied' : recorder.state.error === 'unsupported' ? 'micUnsupported' : 'micFailed';
    notify.error(t(key));
    recorder.cancel();
  }, [recorder, t]);

  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.url);
  }, [photo]);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, []);
  useEffect(resize, [text, resize]);

  const trimmed = text.trim();
  const canSend = !disabled && (trimmed.length > 0 || photo !== null) && text.length <= CHAT_LIMITS.textMax;

  function submit() {
    if (!canSend) return;
    if (photo) {
      // The blob URL now belongs to the pending message; don't revoke it here.
      onSend({ type: 'photo', file: photo.file, text: trimmed || undefined, width: photo.width, height: photo.height });
      setPhoto(null);
    } else {
      onSend({ type: 'text', text: trimmed });
    }
    setText('');
    textareaRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  async function onPickFile(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    const invalid = validateAvatarFile(file);
    if (invalid) {
      notify.error(errorMessage(invalid));
      return;
    }
    const url = URL.createObjectURL(file);
    const size = await readImageSize(url);
    setPhoto((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return { file, url, ...size };
    });
    textareaRef.current?.focus();
  }

  function sendLocation(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        notify.error(t('locationError'));
        reject(new Error('unsupported'));
        return;
      }
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocating(false);
          onSend({ type: 'location', lat: position.coords.latitude, lng: position.coords.longitude });
          resolve();
        },
        () => {
          setLocating(false);
          notify.error(t('locationError'));
          reject(new Error('denied'));
        },
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
      );
    });
  }

  if (recording) {
    const elapsed = recorder.state.status === 'recording' ? recorder.state.elapsedSec : 0;
    return (
      <div className="flex items-center gap-2 px-3 py-2" data-testid="voice-recorder">
        <IconButton aria-label={t('cancelRecording')} variant="ghost" onClick={recorder.cancel}>
          <Trash2 />
        </IconButton>
        <div role="status" className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-muted px-4 py-2.5 text-[0.9375rem]">
          <span aria-hidden="true" className="size-2.5 shrink-0 animate-pulse rounded-full bg-danger" />
          <span className="truncate">{recorder.state.status === 'requesting' ? t('micRequesting') : t('recording')}</span>
          <span className="ms-auto shrink-0 tabular-nums text-muted-foreground">
            {formatDuration(elapsed)} / {formatDuration(LIMITS.voiceMaxSec)}
          </span>
        </div>
        <IconButton aria-label={t('stopAndSend')} onClick={recorder.stop} disabled={recorder.state.status !== 'recording'}>
          <SendHorizontal className="rtl:rotate-180" />
        </IconButton>
      </div>
    );
  }

  const showCounter = text.length >= COUNTER_FROM;
  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      {photo ? (
        <div className="flex items-center gap-3 rounded-xl border bg-card p-2" data-testid="photo-draft">
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
          <img src={photo.url} alt="" className="size-14 shrink-0 rounded-lg object-cover" />
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{t('photoReady')}</span>
          <IconButton aria-label={t('removePhoto')} size="sm" variant="ghost" onClick={() => setPhoto(null)}>
            <X />
          </IconButton>
        </div>
      ) : null}

      <div className="flex items-end gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton aria-label={t('attach')} variant="ghost" disabled={disabled || locating} className="shrink-0">
              {locating ? <Spinner size="sm" label={t('locating')} /> : <Paperclip />}
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top">
            <DropdownMenuItem onSelect={() => fileRef.current?.click()}>
              <ImageIcon aria-hidden="true" />
              {t('photo')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setLocationOpen(true)}>
              <MapPin aria-hidden="true" />
              {t('location')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="photo-input"
          onChange={(event) => void onPickFile(event.target.files?.[0])}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <label htmlFor={inputId} className="sr-only">
            {t('label')}
          </label>
          <textarea
            ref={textareaRef}
            id={inputId}
            rows={1}
            value={text}
            maxLength={CHAT_LIMITS.textMax}
            placeholder={photo ? t('caption') : t('placeholder')}
            onChange={(event) => {
              setText(event.target.value);
              if (event.target.value.trim()) onTyping();
            }}
            onKeyDown={onKeyDown}
            enterKeyHint="send"
            aria-describedby={`${counterId}-hint${showCounter ? ` ${counterId}` : ''}`}
            className={cn(
              'block max-h-40 min-h-11 w-full resize-none rounded-[1.375rem] border border-input bg-card px-4 py-2.5 text-base leading-6 text-foreground',
              'placeholder:text-muted-foreground focus-ring focus-visible:outline-offset-0',
            )}
            data-testid="composer-input"
          />
          <span id={`${counterId}-hint`} className="sr-only">
            {t('hint')}
          </span>
          {showCounter ? (
            <span
              id={counterId}
              className={cn('self-end pe-2 pt-0.5 text-xs tabular-nums', text.length >= CHAT_LIMITS.textMax ? 'font-medium text-danger' : 'text-warning')}
            >
              <span aria-hidden="true">
                {text.length} / {CHAT_LIMITS.textMax}
              </span>
              <span className="sr-only">{t('counter', { count: text.length, max: CHAT_LIMITS.textMax })}</span>
            </span>
          ) : null}
        </div>

        {trimmed || photo ? (
          <IconButton aria-label={photo ? t('sendPhoto') : t('send')} onClick={submit} disabled={!canSend} className="shrink-0" data-testid="composer-send">
            <SendHorizontal className="rtl:rotate-180" />
          </IconButton>
        ) : (
          <IconButton aria-label={t('record')} variant="secondary" onClick={recorder.start} disabled={disabled} className="shrink-0">
            <Mic />
          </IconButton>
        )}
      </div>

      <ConfirmDialog
        open={locationOpen}
        onOpenChange={setLocationOpen}
        title={t('locationConfirm.title')}
        description={t('locationConfirm.description')}
        confirmLabel={t('locationConfirm.confirm')}
        onConfirm={sendLocation}
      />
    </div>
  );
}

