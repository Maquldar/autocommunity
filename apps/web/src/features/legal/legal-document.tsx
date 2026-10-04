import { FileWarning } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';

export const PRIVACY_SECTIONS = ['controller', 'data', 'location', 'plates', 'retention', 'sharing', 'rights', 'law', 'contact'] as const;
export const TERMS_SECTIONS = ['acceptance', 'service', 'emergency', 'conduct', 'rating', 'liability', 'account', 'law', 'changes'] as const;

export type LegalSection = { id: string; title: string; body: string; extra?: ReactNode };

/** Draft legal text: title, "draft" banner, table of contents and numbered sections. */
export async function LegalDocument({ title, intro, sections }: { title: string; intro: string; sections: LegalSection[] }) {
  const t = await getTranslations('legal');
  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <Badge variant="warning" className="self-start">
          <FileWarning aria-hidden="true" />
          {t('draftBadge')}
        </Badge>
        <h1 className="text-3xl font-bold leading-9 tracking-tight text-balance">{title}</h1>
        <p className="text-sm text-muted-foreground">{t('updated', { date: '2026-10-04' })}</p>
        <p className="rounded-xl bg-warning-soft p-3.5 text-sm text-warning-soft-foreground">{t('draftNote')}</p>
        <p className="text-[0.9375rem] leading-6 text-pretty">{intro}</p>
      </header>

      <nav aria-label={t('contents')} className="rounded-2xl border bg-card p-4 sm:p-5">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('contents')}</h2>
        <ol className="flex list-decimal flex-col gap-1.5 ps-5 text-[0.9375rem]">
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="text-primary underline-offset-4 hover:underline focus-ring rounded-sm">
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {sections.map((section, index) => (
        <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="flex scroll-mt-20 flex-col gap-3">
          <h2 id={`${section.id}-title`} className="text-xl font-semibold tracking-tight">
            {index + 1}. {section.title}
          </h2>
          {section.body.split('\n\n').map((paragraph) => (
            <p key={paragraph.slice(0, 40)} className="text-[0.9375rem] leading-7 text-pretty break-words">
              {paragraph}
            </p>
          ))}
          {section.extra}
        </section>
      ))}
    </article>
  );
}
