'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { cn } from '@/lib/cn';
import { LanguageSwitcher } from './language-switcher';
import { Logo, LogoMark } from './logo';
import { getNavItems, isNavItemActive, NAV_ITEMS, type NavItem } from './nav-config';
import { ThemeToggle } from './theme-toggle';

export type AppShellProps = {
  children: ReactNode;
  /** Page title shown in the top bar. Pages still render their own <h1> (PageHeader). */
  title?: ReactNode;
  /** Extra top-bar actions (rendered before the bell). */
  actions?: ReactNode;
  /** Usually <NotificationBell />. */
  notificationSlot?: ReactNode;
  /** Usually an Avatar-triggered DropdownMenu. */
  accountSlot?: ReactNode;
  /** Override the nav source (tests, styleguide). Defaults to NAV_ITEMS. */
  navItems?: readonly NavItem[];
};

/** Pages that fill the whole content area edge to edge (no gutters, no page scroll): the map. */
export const FULL_BLEED_ROUTES: readonly string[] = ['/map'];

/**
 * Signed-in app frame: mobile top bar + bottom tab bar, desktop (≥1024px) sidebar.
 * Handles safe areas, the skip link and the offline banner.
 */
export function AppShell({ children, title, actions, notificationSlot, accountSlot, navItems = NAV_ITEMS }: AppShellProps) {
  const t = useTranslations('shell');
  const pathname = usePathname();
  const tabs = getNavItems('tab', navItems);
  const secondary = getNavItems('secondary', navItems);
  const hasTabs = tabs.length > 0;
  const fullBleed = FULL_BLEED_ROUTES.includes(pathname);

  return (
    <div className={fullBleed ? 'h-dvh overflow-hidden' : 'min-h-dvh'}>
      <a
        href="#main-content"
        className={cn(
          buttonVariants({ variant: 'primary', size: 'md' }),
          'fixed start-3 top-[calc(var(--safe-top)+0.75rem)] z-skip -translate-y-[200%] focus-visible:translate-y-0',
        )}
      >
        {t('skipToContent')}
      </a>

      <Sidebar tabs={tabs} secondary={secondary} pathname={pathname} />

      <div className={cn('flex flex-col lg:ps-[var(--sidebar-width)]', fullBleed ? 'h-dvh' : 'min-h-dvh')}>
        <header className="sticky top-0 z-header border-b bg-background/85 pt-safe backdrop-blur-md supports-[backdrop-filter]:bg-background/75">
          <OfflineBanner />
          <div className="mx-auto flex h-[var(--header-height)] w-full max-w-content items-center gap-2 px-safe">
            <div className="flex min-w-0 flex-1 items-center gap-2.5 ps-4 sm:ps-6">
              <Link href="/" aria-label={t('home')} className="shrink-0 rounded-lg focus-ring lg:hidden">
                <LogoMark className="size-7" />
              </Link>
              {title ? <div className="truncate text-[1.0625rem] font-semibold tracking-tight">{title}</div> : null}
            </div>
            <div className="flex shrink-0 items-center gap-0.5 pe-2 sm:pe-4">
              {actions}
              {notificationSlot}
              {accountSlot}
            </div>
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            fullBleed
              ? // The page positions itself inside and keeps clear of the bottom tab bar on phones.
                'relative flex min-h-0 w-full flex-1 flex-col outline-none'
              : cn(
                  'mx-auto flex w-full max-w-content flex-1 flex-col pt-4 outline-none lg:pb-12',
                  'ps-[max(1rem,var(--safe-left))] pe-[max(1rem,var(--safe-right))]',
                  'sm:ps-[max(1.5rem,var(--safe-left))] sm:pe-[max(1.5rem,var(--safe-right))]',
                  hasTabs ? 'pb-[calc(var(--nav-height)+var(--safe-bottom)+1.5rem)]' : 'pb-[calc(var(--safe-bottom)+1.5rem)]',
                ),
          )}
        >
          {children}
        </main>
      </div>

      {hasTabs ? <BottomTabBar items={tabs} pathname={pathname} /> : null}
    </div>
  );
}

function BottomTabBar({ items, pathname }: { items: NavItem[]; pathname: string }) {
  const t = useTranslations();
  return (
    <nav
      aria-label={t('shell.primaryNav')}
      className="fixed inset-x-0 bottom-0 z-nav border-t bg-card/95 pb-safe px-safe backdrop-blur-md lg:hidden"
    >
      <ul
        className="mx-auto grid h-[var(--nav-height)] max-w-lg items-stretch"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((item) => {
          const active = isNavItemActive(item, pathname);
          const Icon = item.icon;
          const label = t(`nav.${item.labelKey}`);

          if (item.emphasis === 'sos') {
            return (
              <li key={item.key} className="flex justify-center">
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className="group flex flex-col items-center justify-end gap-0.5 pb-1.5 focus-visible:outline-none"
                >
                  <span className="-mt-6 flex size-14 items-center justify-center rounded-full bg-sos text-sos-foreground shadow-lg ring-4 ring-card transition-transform duration-fast group-hover:bg-sos-hover group-active:scale-95 group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-ring">
                    <Icon aria-hidden="true" className="size-7" strokeWidth={2.25} />
                  </span>
                  <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-sos-soft-foreground">{label}</span>
                </Link>
              </li>
            );
          }

          return (
            <li key={item.key} className="flex">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group flex flex-1 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium focus-visible:outline-none',
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-base group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-ring',
                    active && 'bg-primary-soft text-primary-soft-foreground',
                  )}
                >
                  <Icon aria-hidden="true" className="size-[1.375rem]" strokeWidth={active ? 2.25 : 1.75} />
                </span>
                <span className={cn('max-w-full truncate px-1', active && 'font-semibold')}>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Sidebar({ tabs, secondary, pathname }: { tabs: NavItem[]; secondary: NavItem[]; pathname: string }) {
  const t = useTranslations();
  const sos = tabs.find((item) => item.emphasis === 'sos');
  const primary = tabs.filter((item) => item.emphasis !== 'sos');

  return (
    <aside className="fixed inset-y-0 start-0 z-nav hidden w-[var(--sidebar-width)] flex-col border-e bg-card pt-safe pb-safe lg:flex">
      <div className="flex h-[var(--header-height)] items-center px-5">
        <Link href="/" className="rounded-lg focus-ring">
          <Logo />
        </Link>
      </div>

      <nav aria-label={t('shell.primaryNav')} className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4">
        {sos ? (
          <Link
            href={sos.href}
            aria-current={isNavItemActive(sos, pathname) ? 'page' : undefined}
            className={cn(buttonVariants({ variant: 'sos', size: 'lg', fullWidth: true }), 'justify-start')}
          >
            <sos.icon aria-hidden="true" />
            {t(`nav.${sos.labelKey}`)}
          </Link>
        ) : null}
        {primary.length > 0 ? <SidebarList items={primary} pathname={pathname} /> : null}
        {secondary.length > 0 ? (
          <div className="flex flex-col gap-1">
            {primary.length > 0 ? (
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('shell.more')}
              </p>
            ) : null}
            <SidebarList items={secondary} pathname={pathname} />
          </div>
        ) : null}
      </nav>

      <div className="flex items-center justify-between gap-2 border-t px-3 py-3">
        <span className="ps-2 text-xs text-muted-foreground">{t('shell.preferences')}</span>
        <div className="flex items-center">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}

function SidebarList({ items, pathname }: { items: NavItem[]; pathname: string }) {
  const t = useTranslations('nav');
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = isNavItemActive(item, pathname);
        const Icon = item.icon;
        return (
          <li key={item.key}>
            <Link
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-11 items-center gap-3 rounded-lg px-3 text-[0.9375rem] font-medium transition-colors duration-fast focus-ring',
                active
                  ? 'bg-primary-soft text-primary-soft-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon aria-hidden="true" className="size-5 shrink-0" strokeWidth={active ? 2.25 : 1.75} />
              {t(item.labelKey)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
