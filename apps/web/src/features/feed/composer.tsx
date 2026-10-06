'use client';

import { FEED_LIMITS, LIMITS, type PostDto } from '@autoc/shared';
import { Film, ImagePlus, ListChecks, Plus, Send, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import { useMyCommunities } from '@/features/communities/queries';
import { useCreatePost } from './api';
import { useFeedErrorMessage } from './errors';
import { uploadWithProgress, videoDuration } from './upload';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const EVERYONE = '__everyone';

type Attachment = {
  key: string;
  kind: 'photo' | 'video';
  previewUrl: string;
  progress: number;
  uploadId: string | null;
  error: string | null;
  controller: AbortController;
};

let seq = 0;

/**
 * New post: text, up to 6 photos or one video (uploaded right away, with progress), an optional poll
 * (2–6 options, multiple choice) and, outside a community page, where to post (everyone / a community).
 */
export function Composer({ communityId, onPosted }: { communityId?: string; onPosted?: (post: PostDto) => void }) {
  const t = useTranslations('feed.composer');
  const online = useOnlineStatus();
  const errorMessage = useFeedErrorMessage();
  const create = useCreatePost();
  const ids = useId();
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pollOpen, setPollOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [target, setTarget] = useState<string>(EVERYONE);
  const [error, setError] = useState<string | null>(null);
  const mine = useMyCommunities(!communityId);
  const memberOf = mine.data?.filter((c) => c.myMembership?.status === 'active') ?? [];

  // Revoke preview URLs on unmount.
  const latest = useRef(attachments);
  latest.current = attachments;
  useEffect(() => () => latest.current.forEach((a) => URL.revokeObjectURL(a.previewUrl)), []);

  const patch = (key: string, update: Partial<Attachment>) => setAttachments((list) => list.map((a) => (a.key === key ? { ...a, ...update } : a)));

  const startUpload = async (file: File, kind: 'photo' | 'video') => {
    const att: Attachment = { key: `a${seq++}`, kind, previewUrl: URL.createObjectURL(file), progress: 0, uploadId: null, error: null, controller: new AbortController() };
    setAttachments((list) => [...list, att]);
    try {
      const durationSec = kind === 'video' ? await videoDuration(file) : undefined;
      const res = await uploadWithProgress(file, kind === 'video' ? 'video' : 'post', (p) => patch(att.key, { progress: p }), { signal: att.controller.signal, durationSec });
      patch(att.key, { uploadId: res.id, progress: 1 });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      patch(att.key, { error: errorMessage(e) });
    }
  };

  const addPhotos = (files: FileList | null) => {
    setError(null);
    const room = FEED_LIMITS.mediaMax - attachments.length;
    const list = Array.from(files ?? []);
    if (list.length > room) setError(t('tooManyPhotos', { max: FEED_LIMITS.mediaMax }));
    for (const file of list.slice(0, room)) {
      if (file.type && !IMAGE_TYPES.includes(file.type)) {
        setError(errorMessage(new ApiError({ status: 415, code: 'UNSUPPORTED_FILE_TYPE', message: '' })));
        continue;
      }
      if (file.size > LIMITS.imageMaxBytes) {
        setError(errorMessage(new ApiError({ status: 413, code: 'FILE_TOO_LARGE', message: '' })));
        continue;
      }
      void startUpload(file, 'photo');
    }
  };

  const addVideo = (files: FileList | null) => {
    setError(null);
    const file = files?.[0];
    if (!file) return;
    if (file.type && !VIDEO_TYPES.includes(file.type)) {
      setError(errorMessage(new ApiError({ status: 415, code: 'UNSUPPORTED_FILE_TYPE', message: '' })));
      return;
    }
    if (file.size > LIMITS.videoMaxBytes) {
      setError(t('videoTooLarge', { mb: Math.round(LIMITS.videoMaxBytes / 1024 / 1024) }));
      return;
    }
    void startUpload(file, 'video');
  };

  const removeAttachment = (a: Attachment) => {
    a.controller.abort();
    URL.revokeObjectURL(a.previewUrl);
    setAttachments((list) => list.filter((x) => x.key !== a.key));
  };

  const uploading = attachments.some((a) => !a.uploadId && !a.error);
  const hasVideo = attachments.some((a) => a.kind === 'video');
  const reset = () => {
    attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    setText('');
    setAttachments([]);
    setPollOpen(false);
    setQuestion('');
    setOptions(['', '']);
    setMultiple(false);
    setError(null);
  };

  const submit = () => {
    setError(null);
    const body = text.trim();
    const media = attachments.filter((a) => a.uploadId).map((a) => a.uploadId!);
    if (attachments.some((a) => a.error)) return setError(t('removeFailed'));
    let poll: { question: string; options: string[]; multiple: boolean } | null = null;
    if (pollOpen) {
      const opts = options.map((o) => o.trim()).filter(Boolean);
      if (question.trim().length < FEED_LIMITS.pollQuestionMin) return setError(t('pollQuestionShort', { min: FEED_LIMITS.pollQuestionMin }));
      if (opts.length < FEED_LIMITS.pollOptionsMin) return setError(t('pollOptionsShort', { min: FEED_LIMITS.pollOptionsMin }));
      if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) return setError(t('pollOptionsSame'));
      poll = { question: question.trim(), options: opts, multiple };
    }
    if (!body && !media.length && !poll) return setError(t('empty'));
    if (body.length > FEED_LIMITS.textMax) return setError(t('tooLong', { max: FEED_LIMITS.textMax }));
    create.mutate(
      {
        text: body || undefined,
        mediaUploadIds: media.length ? media : undefined,
        communityId: communityId ?? (target === EVERYONE ? null : target),
        poll,
      },
      {
        onSuccess: (post) => {
          reset();
          notify.success(t('posted'));
          onPosted?.(post);
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };

  return (
    <section aria-labelledby={`${ids}-title`} className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm" data-testid="composer">
      <h2 id={`${ids}-title`} className="sr-only">
        {t('title')}
      </h2>
      <Label htmlFor={`${ids}-text`} className="sr-only">
        {t('textLabel')}
      </Label>
      <Textarea
        id={`${ids}-text`}
        rows={3}
        placeholder={t('placeholder')}
        value={text}
        maxLength={FEED_LIMITS.textMax}
        showCount={text.length > FEED_LIMITS.textMax * 0.8}
        onChange={(e) => setText(e.target.value)}
      />

      {attachments.length ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label={t('attachments')}>
          {attachments.map((a, i) => (
            <li key={a.key} className="relative aspect-square overflow-hidden rounded-xl border bg-muted" data-testid="attachment">
              {a.kind === 'video' ? (
                <video src={a.previewUrl} muted playsInline className="size-full object-cover" aria-label={t('videoPreview')} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- local preview
                <img src={a.previewUrl} alt={t('photoPreview', { index: i + 1 })} className="size-full object-cover" />
              )}
              {!a.uploadId && !a.error ? (
                <div className="absolute inset-x-1 bottom-1">
                  <div
                    role="progressbar"
                    aria-label={t('uploading')}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(a.progress * 100)}
                    className="h-1.5 overflow-hidden rounded-full bg-card/80"
                  >
                    <div className="h-full bg-primary transition-[width] duration-fast" style={{ width: `${Math.round(a.progress * 100)}%` }} />
                  </div>
                </div>
              ) : null}
              {a.error ? (
                <p role="alert" className="absolute inset-x-0 bottom-0 bg-danger-soft px-1 py-0.5 text-center text-xs text-danger-soft-foreground">
                  {t('uploadFailed')}
                </p>
              ) : null}
              <IconButton aria-label={t('removeAttachment', { index: i + 1 })} size="sm" variant="secondary" className="absolute end-1 top-1 shadow-sm" onClick={() => removeAttachment(a)}>
                <X />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : null}

      {pollOpen ? (
        <fieldset className="flex flex-col gap-2 rounded-xl border bg-background p-3" data-testid="poll-builder">
          <legend className="px-1 text-sm font-medium">{t('pollTitle')}</legend>
          <Label htmlFor={`${ids}-q`}>{t('pollQuestion')}</Label>
          <Input id={`${ids}-q`} value={question} maxLength={FEED_LIMITS.pollQuestionMax} onChange={(e) => setQuestion(e.target.value)} />
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                aria-label={t('pollOption', { index: i + 1 })}
                placeholder={t('pollOption', { index: i + 1 })}
                value={o}
                maxLength={FEED_LIMITS.pollOptionMax}
                onChange={(e) => setOptions((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
              />
              {options.length > FEED_LIMITS.pollOptionsMin ? (
                <IconButton aria-label={t('removeOption', { index: i + 1 })} variant="ghost" onClick={() => setOptions((list) => list.filter((_, j) => j !== i))}>
                  <Trash2 />
                </IconButton>
              ) : null}
            </div>
          ))}
          {options.length < FEED_LIMITS.pollOptionsMax ? (
            <Button variant="ghost" size="sm" className="self-start" leadingIcon={<Plus aria-hidden="true" />} onClick={() => setOptions((list) => [...list, ''])}>
              {t('addOption')}
            </Button>
          ) : null}
          <div className="flex min-h-11 items-center justify-between gap-3">
            <Label htmlFor={`${ids}-multi`}>{t('pollMultiple')}</Label>
            <Switch id={`${ids}-multi`} checked={multiple} onCheckedChange={setMultiple} />
          </div>
          <Button variant="ghost" size="sm" className="self-start" leadingIcon={<X aria-hidden="true" />} onClick={() => setPollOpen(false)}>
            {t('removePoll')}
          </Button>
        </fieldset>
      ) : null}

      {!communityId ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={`${ids}-target`}>{t('audience')}</Label>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger id={`${ids}-target`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EVERYONE}>{t('everyone')}</SelectItem>
              {memberOf.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <FormError>{error}</FormError>

      <div className="flex flex-wrap items-center gap-1">
        <IconButton
          aria-label={t('addPhotos', { max: FEED_LIMITS.mediaMax })}
          variant="ghost"
          disabled={hasVideo || attachments.length >= FEED_LIMITS.mediaMax}
          onClick={() => photoInput.current?.click()}
        >
          <ImagePlus />
        </IconButton>
        <IconButton aria-label={t('addVideo')} variant="ghost" disabled={attachments.length > 0} onClick={() => videoInput.current?.click()}>
          <Film />
        </IconButton>
        <IconButton aria-label={t('addPoll')} aria-pressed={pollOpen} variant="ghost" className={cn(pollOpen && 'text-primary')} onClick={() => setPollOpen((o) => !o)}>
          <ListChecks />
        </IconButton>
        <Button className="ms-auto" leadingIcon={<Send aria-hidden="true" />} onClick={submit} loading={create.isPending} disabled={uploading || !online} data-testid="publish">
          {uploading ? t('waitUploads') : t('publish')}
        </Button>
      </div>
      <input
        ref={photoInput}
        type="file"
        multiple
        accept={IMAGE_TYPES.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="post-photo-input"
        onChange={(e) => {
          addPhotos(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={videoInput}
        type="file"
        accept={VIDEO_TYPES.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="post-video-input"
        onChange={(e) => {
          addVideo(e.target.files);
          e.target.value = '';
        }}
      />
      <p className="sr-only" aria-live="polite">
        {uploading ? t('uploading') : ''}
      </p>
    </section>
  );
}
