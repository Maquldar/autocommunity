'use client';

import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Avatar } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RatingBadge } from '@/components/ui/rating-badge';
import { NAV_ITEMS } from './nav-config';

export type AccountMenuUser = { id: string; name: string; nickname: string | null; avatarUrl: string | null; rating: number };

const MENU_KEYS = ['profile', 'friends', 'settings'] as const;

/** Avatar-triggered menu for the top bar `accountSlot`. Links come from nav-config so disabled pages never show. */
export function AccountMenu({ user, onLogout }: { user: AccountMenuUser; onLogout: () => void }) {
  const t = useTranslations();
  const links = NAV_ITEMS.filter((item) => item.enabled && (MENU_KEYS as readonly string[]).includes(item.key));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('shell.accountMenu')}
        className="ms-1 inline-flex size-11 items-center justify-center rounded-full focus-ring"
      >
        <Avatar id={user.id} name={user.name} src={user.avatarUrl} size="sm" decorative />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-3 py-2 normal-case tracking-normal">
          <Avatar id={user.id} name={user.name} src={user.avatarUrl} size="md" decorative />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold text-foreground">{user.name}</span>
            {user.nickname ? <span className="truncate text-xs font-normal">@{user.nickname}</span> : null}
          </span>
          <RatingBadge rating={user.rating} size="sm" />
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {links.map((item) => (
          <DropdownMenuItem key={item.key} asChild>
            <Link href={item.href}>
              <item.icon aria-hidden="true" />
              {t(`nav.${item.labelKey}`)}
            </Link>
          </DropdownMenuItem>
        ))}
        {links.length > 0 ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem onSelect={onLogout}>
          <LogOut aria-hidden="true" />
          {t('common.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
