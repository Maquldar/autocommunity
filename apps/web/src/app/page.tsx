import { ArrowRight, LifeBuoy, MapPinned, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LanguageSwitcher } from '@/components/shell/language-switcher';
import { Logo } from '@/components/shell/logo';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HeroMap } from './hero-map';

export default async function LandingPage() {
  const t = await getTranslations();
  const features = [
    { icon: MapPinned, text: t('landing.featureMap') },
    { icon: UsersRound, text: t('landing.featureCommunities') },
    { icon: LifeBuoy, text: t('landing.featureHelp') },
  ];

  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip pt-safe pb-safe px-safe">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <div className="flex items-center">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <main id="main-content" className="mx-auto grid w-full max-w-6xl grid-cols-1 flex-1 items-center gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:py-16">
        <section className="flex flex-col items-start">
          <Badge variant="primary">{t('landing.eyebrow')}</Badge>
          <h1 className="mt-5 text-[2.25rem] font-bold leading-[1.1] tracking-tight text-balance sm:text-5xl lg:text-[3.5rem]">
            {t('landing.title')}
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-7 text-muted-foreground text-pretty">{t('landing.pitch')}</p>

          <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto">
            <Button asChild size="xl" trailingIcon={<ArrowRight aria-hidden="true" className="rtl:rotate-180" />}>
              <Link href="/login">{t('common.getStarted')}</Link>
            </Button>
            <p className="text-sm text-muted-foreground sm:text-center">{t('landing.signIn')}</p>
          </div>

          <ul className="mt-10 grid w-full grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {features.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-[0.9375rem] font-medium">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-card text-primary shadow-sm ring-1 ring-border">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </section>

        <HeroMap label={t('landing.mapIllustration')} />
      </main>

      <footer className="mx-auto w-full max-w-6xl px-4 py-6 text-sm text-muted-foreground sm:px-6">
        © {new Date().getFullYear()} AutoCommunity · {t('landing.footer')}
      </footer>
    </div>
  );
}
