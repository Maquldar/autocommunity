'use client';

import { SERVICE_LIMITS } from '@autoc/shared';
import { Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { FormField } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import { useCreateReview } from './api';
import { useServiceErrorMessage } from './errors';

/** 1–5 star picker built on native radios: arrow keys move, Space selects, each star has a spoken label. */
export function StarInput({
  value,
  onChange,
  invalid,
  describedBy,
  labelledBy,
}: {
  value: number;
  onChange: (v: number) => void;
  invalid?: boolean;
  describedBy?: string;
  labelledBy: string;
}) {
  const t = useTranslations('services.review');
  const name = useId();
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-required
      className="flex gap-1"
      onMouseLeave={() => setHover(0)}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <label
          key={n}
          className="relative flex size-11 cursor-pointer items-center justify-center rounded-lg has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
          onMouseEnter={() => setHover(n)}
        >
          <input
            type="radio"
            name={name}
            value={n}
            checked={value === n}
            onChange={() => onChange(n)}
            className="peer sr-only"
            aria-label={t('starOption', { count: n })}
          />
          <Star
            aria-hidden="true"
            strokeWidth={1.75}
            className={cn('size-8 transition-colors duration-fast', n <= shown ? 'fill-warning text-warning' : 'fill-none text-input')}
          />
        </label>
      ))}
    </div>
  );
}

/** Stars + optional comment for a verified, unreviewed visit. */
export function ReviewForm({ serviceId, serviceName, visitId }: { serviceId: string; serviceName: string; visitId: string }) {
  const t = useTranslations('services.review');
  const errorMessage = useServiceErrorMessage();
  const create = useCreateReview(serviceId);
  const labelId = useId();
  const starsErrorId = useId();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [starsError, setStarsError] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError(null);
    if (stars < 1) {
      setStarsError(true);
      groupRef.current?.querySelector<HTMLInputElement>('input')?.focus();
      return;
    }
    try {
      await create.mutateAsync({ visitId, stars, comment: comment.trim() || null });
      notify.success(t('success'));
    } catch (err) {
      setServerError(errorMessage(err));
    }
  };

  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" aria-label={t('title')}>
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold">{t('title')}</h3>
        <p className="text-sm text-muted-foreground">{t('description', { name: serviceName })}</p>
      </div>
      <div ref={groupRef} className="flex flex-col gap-1.5">
        <span id={labelId} className="text-[0.9375rem] font-medium">
          {t('starsLabel')}
          <span aria-hidden="true" className="ms-0.5 text-danger">
            *
          </span>
        </span>
        <StarInput
          value={stars}
          onChange={(v) => {
            setStars(v);
            setStarsError(false);
          }}
          invalid={starsError}
          describedBy={starsError ? starsErrorId : undefined}
          labelledBy={labelId}
        />
        {starsError ? (
          <p id={starsErrorId} className="text-sm text-danger">
            {t('starsRequired')}
          </p>
        ) : null}
      </div>
      <FormField label={t('comment')}>
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={SERVICE_LIMITS.reviewCommentMax}
          showCount
          rows={3}
          placeholder={t('commentPlaceholder')}
        />
      </FormField>
      <FormError>{serverError}</FormError>
      <Button type="submit" size="lg" loading={create.isPending} className="w-full sm:w-auto sm:self-end">
        {t('submit')}
      </Button>
    </form>
  );
}
