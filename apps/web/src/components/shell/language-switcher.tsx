'use client';

import type { Locale } from '@autoc/shared';
import { Languages } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { isLocale, LOCALE_COOKIE, locales } from '@/i18n/config';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IconButton } from '@/components/ui/icon-button';
import { SegmentedControl } from '@/components/ui/segmented-control';

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Writes NEXT_LOCALE and re-renders server components in the new language. */
function useSetLocale(onLocaleChange?: (locale: Locale) => void) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function setLocale(next: Locale) {
    const secure = window.location.protocol === 'https:' ? '; secure' : '';
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax${secure}`;
    document.documentElement.lang = next;
    onLocaleChange?.(next);
    startTransition(() => router.refresh());
  }
  return { setLocale, pending };
}

/** Language names are always shown in their own language, so they need no translation. */
const NATIVE_NAMES: Record<Locale, string> = { ru: 'Русский', en: 'English' };

export function LanguageSwitcher({
  variant = 'menu',
  className,
  onLocaleChange,
}: {
  variant?: 'menu' | 'segmented';
  className?: string;
  /** Called after the cookie is written, e.g. to save the choice to the profile. */
  onLocaleChange?: (locale: Locale) => void;
}) {
  const t = useTranslations('language');
  const active = useLocale();
  const { setLocale, pending } = useSetLocale(onLocaleChange);

  if (variant === 'segmented') {
    return (
      <SegmentedControl
        label={t('label')}
        value={isLocale(active) ? active : locales[0]}
        onValueChange={(code) => code !== active && setLocale(code)}
        disabled={pending}
        className={className}
        options={locales.map((code) => ({ value: code, label: NATIVE_NAMES[code], lang: code }))}
      />
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label={t('label')} loading={pending} className={className}>
          <Languages />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={active} onValueChange={(value) => isLocale(value) && setLocale(value)}>
          {locales.map((code) => (
            <DropdownMenuRadioItem key={code} value={code} lang={code}>
              {NATIVE_NAMES[code]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
