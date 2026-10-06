'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

export const ADMIN_SECTIONS = [
  { key: 'dashboard', href: '/admin' },
  { key: 'users', href: '/admin/users' },
  { key: 'reports', href: '/admin/reports' },
  { key: 'sos', href: '/admin/sos' },
  { key: 'communities', href: '/admin/communities' },
  { key: 'services', href: '/admin/services' },
  { key: 'visits', href: '/admin/visits' },
  { key: 'fraud', href: '/admin/fraud' },
  { key: 'audit', href: '/admin/audit' },
] as const;

export function isSectionActive(href: string, pathname: string): boolean {
  return href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`);
}

/** Section tabs of the admin area; scrolls sideways on phones. */
export function AdminNav() {
  const t = useTranslations('admin.nav');
  const pathname = usePathname();
  return (
    <nav aria-label={t('label')} className="-mx-1 mb-2 overflow-x-auto pb-1">
      <ul className="flex w-max gap-1 px-1">
        {ADMIN_SECTIONS.map((s) => {
          const active = isSectionActive(s.href, pathname);
          return (
            <li key={s.key}>
              <Link
                href={s.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-9 items-center whitespace-nowrap rounded-full px-3.5 text-sm font-medium transition-colors duration-fast focus-ring',
                  active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {t(s.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
