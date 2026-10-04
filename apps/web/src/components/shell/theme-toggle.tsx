'use client';

import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { useMounted } from '@/hooks/use-mounted';
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

const THEMES = ['light', 'dark', 'system'] as const;
type ThemeChoice = (typeof THEMES)[number];
const ICONS: Record<ThemeChoice, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };

function isThemeChoice(value: string | undefined): value is ThemeChoice {
  return value !== undefined && (THEMES as readonly string[]).includes(value);
}

/**
 * Light / dark / system switch.
 * `menu`: icon button with a dropdown (top bars). `segmented`: inline radio group (settings page).
 */
export function ThemeToggle({ variant = 'menu', className }: { variant?: 'menu' | 'segmented'; className?: string }) {
  const t = useTranslations('theme');
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const current: ThemeChoice = mounted && isThemeChoice(theme) ? theme : 'system';

  if (variant === 'segmented') {
    return (
      <SegmentedControl
        label={t('label')}
        value={current}
        onValueChange={setTheme}
        className={className}
        options={THEMES.map((choice) => {
          const Icon = ICONS[choice];
          return { value: choice, label: t(choice), icon: <Icon aria-hidden="true" /> };
        })}
      />
    );
  }

  const TriggerIcon = mounted && resolvedTheme === 'dark' ? Moon : Sun;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label={t('label')} className={className}>
          <TriggerIcon />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current} onValueChange={(value) => setTheme(value)}>
          {THEMES.map((choice) => {
            const Icon = ICONS[choice];
            return (
              <DropdownMenuRadioItem key={choice} value={choice}>
                <Icon aria-hidden="true" />
                {t(choice)}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
