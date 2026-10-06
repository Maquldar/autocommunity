'use client';

import { REVIEW_LIMITS, type UserMini } from '@autoc/shared';
import { CircleAlert, Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { isApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import { useCreateReview } from './api';

/** Review error codes → `rating.review.errors.*` (null → generic message). */
export function reviewErrorKey(error: unknown): 'alreadyReviewed' | 'windowClosed' | 'notAllowed' | null {
  if (!isApiError(error)) return null;
  if (error.code === 'ALREADY_REVIEWED') return 'alreadyReviewed';
  if (error.code === 'REVIEW_WINDOW_CLOSED') return 'windowClosed';
  if (error.code === 'REVIEW_NOT_ALLOWED') return 'notAllowed';
  return null;
}

/**
 * 1–5 stars as a real radio group (native inputs: arrow keys, one tab stop, a name per star),
 * drawn as large star icons. Hover previews; the chosen value is also spelled out in words.
 */
export function StarInput({ value, onChange, invalid }: { value: number; onChange: (v: number) => void; invalid?: boolean }) {
  const t = useTranslations('rating.review');
  const name = useId();
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-[0.9375rem] font-medium">
        {t('starsLegend')}
        <span aria-hidden="true" className="ms-0.5 text-danger">
          *
        </span>
      </legend>
      <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)} data-testid="star-input">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="relative cursor-pointer" onMouseEnter={() => setHover(n)}>
            <input
              type="radio"
              name={name}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              className="peer absolute inset-0 z-raised size-full cursor-pointer appearance-none opacity-0"
              aria-label={t('starLabel', { stars: n })}
              aria-invalid={invalid || undefined}
            />
            <span className="flex size-12 items-center justify-center rounded-xl peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
              <Star aria-hidden="true" className={cn('size-9 transition-colors duration-fast', n <= shown ? 'fill-warning text-warning' : 'text-input')} />
            </span>
          </label>
        ))}
      </div>
      <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
        {shown ? t(`starWords.${shown as 1 | 2 | 3 | 4 | 5}`) : ''}
      </p>
    </fieldset>
  );
}

/** Review one person after a closed SOS: stars + optional comment. */
export function ReviewSheet({
  sosId,
  target,
  role,
  open,
  onOpenChange,
}: {
  sosId: string;
  target: UserMini | null;
  /** Who the target was in this SOS (for the title). */
  role: 'helper' | 'requester';
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('rating.review');
  const errorMessage = useErrorMessage();
  const online = useOnlineStatus();
  const create = useCreateReview(sosId);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setStars(0);
    setComment('');
    setMissing(false);
    setError(null);
  }, [open, target?.id]);

  if (!target) return null;
  const name = target.name || `@${target.nickname}`;
  const key = error ? reviewErrorKey(error) : null;

  const submit = async () => {
    if (!stars) {
      setMissing(true);
      return;
    }
    setError(null);
    try {
      await create.mutateAsync({ targetUserId: target.id, stars, comment: comment.trim() || undefined });
      notify.success(t('sent', { name }));
      onOpenChange(false);
    } catch (err) {
      setError(err);
      // Already reviewed / window closed: nothing left to do here, the SOS refresh hides the prompt.
    }
  };

  return (
    <Sheet open={open} onOpenChange={(next) => (create.isPending ? undefined : onOpenChange(next))}>
      <SheetContent data-testid="review-sheet">
        <SheetHeader className="flex-row items-center gap-3">
          <Avatar id={target.id} name={name} src={target.avatarUrl} size="lg" decorative />
          <div className="flex min-w-0 flex-col gap-0.5">
            <SheetTitle className="break-words">{role === 'helper' ? t('titleHelper', { name }) : t('titleRequester', { name })}</SheetTitle>
            <SheetDescription>{t('description')}</SheetDescription>
          </div>
        </SheetHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <StarInput
            value={stars}
            onChange={(v) => {
              setStars(v);
              setMissing(false);
            }}
            invalid={missing}
          />
          {missing ? (
            <p className="-mt-3 flex items-center gap-1.5 text-sm text-danger" role="alert">
              <CircleAlert aria-hidden="true" className="size-4" />
              {t('starsRequired')}
            </p>
          ) : null}
          <FormField label={t('commentLabel')} hint={t('commentHint')}>
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={REVIEW_LIMITS.commentMax} showCount rows={3} />
          </FormField>
          {error ? (
            <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground" data-testid="review-error">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {key ? t(`errors.${key}`) : errorMessage(error)}
            </p>
          ) : null}
          <SheetFooter className="sm:flex-row-reverse">
            <Button type="submit" size="lg" fullWidth loading={create.isPending} disabled={!online}>
              {t('submit')}
            </Button>
            <Button variant="ghost" size="lg" fullWidth onClick={() => onOpenChange(false)} disabled={create.isPending}>
              {t('later')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
