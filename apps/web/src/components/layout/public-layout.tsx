import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { LanguageSwitcher } from '@/components/shell/language-switcher';
import { Logo } from '@/components/shell/logo';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { cn } from '@/lib/cn';

/** Frame for signed-out pages (login, onboarding, legal): logo, language/theme, centred column. */
export async function PublicLayout({ children, width = 'narrow' }: { children: ReactNode; width?: 'narrow' | 'form' }) {
  const t = await getTranslations();
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip pt-safe pb-safe px-safe">
      <a
        href="#main-content"
        className="fixed start-3 top-3 z-skip -translate-y-[200%] rounded-lg bg-primary px-4 py-2 text-primary-foreground focus-visible:translate-y-0"
      >
        {t('shell.skipToContent')}
      </a>
      <header className="mx-auto flex h-16 w-full max-w-content items-center justify-between gap-2 px-4 sm:px-6">
        <Link href="/" aria-label={t('shell.home')} className="rounded-lg focus-ring">
          <Logo />
        </Link>
        <div className="flex items-center">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className={cn('mx-auto flex w-full flex-1 flex-col px-4 pb-10 pt-4 outline-none sm:px-6 sm:pt-8', width === 'form' ? 'max-w-md' : 'max-w-narrow')}
      >
        {children}
      </main>
      <footer className="mx-auto flex w-full max-w-content flex-wrap items-center gap-x-4 gap-y-1 px-4 py-6 text-sm text-muted-foreground sm:px-6">
        <span>© {new Date().getFullYear()} AutoCommunity</span>
        <Link href="/legal/terms" className="underline-offset-4 hover:text-foreground hover:underline focus-ring rounded-sm">
          {t('legal.terms.short')}
        </Link>
        <Link href="/legal/privacy" className="underline-offset-4 hover:text-foreground hover:underline focus-ring rounded-sm">
          {t('legal.privacy.short')}
        </Link>
      </footer>
    </div>
  );
}
