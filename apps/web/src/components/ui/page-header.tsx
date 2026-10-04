'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { IconButton } from './icon-button';

export type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  /** `true` → history back; a string → link to that href (use for deep links where history may be empty). */
  back?: boolean | string;
  /** Right-aligned actions: IconButtons or a small Button. */
  actions?: ReactNode;
  /** Use 2 when the header sits below another h1 (e.g. inside a sheet or a demo). */
  headingLevel?: 1 | 2;
  className?: string;
};

export function PageHeader({ title, description, back, actions, headingLevel = 1, className }: PageHeaderProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const t = useTranslations('common');
  const router = useRouter();

  const backButton =
    typeof back === 'string' ? (
      <IconButton asChild aria-label={t('back')} className="-ms-2">
        <Link href={back}>
          <ArrowLeft className="rtl:rotate-180" />
        </Link>
      </IconButton>
    ) : back ? (
      <IconButton aria-label={t('back')} className="-ms-2" onClick={() => router.back()}>
        <ArrowLeft className="rtl:rotate-180" />
      </IconButton>
    ) : null;

  return (
    <header className={cn('flex items-start gap-2 pb-4 pt-2', className)}>
      {backButton}
      <div className={cn('flex min-w-0 flex-1 flex-col gap-1', backButton && 'pt-1.5')}>
        <Heading className="text-2xl font-semibold leading-8 tracking-tight text-balance break-words">{title}</Heading>
        {description ? <p className="text-[0.9375rem] text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </header>
  );
}
