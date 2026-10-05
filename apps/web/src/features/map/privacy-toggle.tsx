'use client';

import type { PrivacyMode } from '@autoc/shared';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { useCurrentUser } from '@/lib/auth/guards';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import { useUpdateSettings } from '@/features/profile/queries';

const previousKey = (userId: string) => `autoc:privacy-before-hidden:${userId}`;

function readPrevious(userId: string): Exclude<PrivacyMode, 'hidden'> {
  try {
    const value = window.localStorage.getItem(previousKey(userId));
    if (value === 'community' || value === 'friends' || value === 'everyone') return value;
  } catch {
    // Storage blocked: fall back to the default mode.
  }
  return 'community';
}

function writePrevious(userId: string, mode: Exclude<PrivacyMode, 'hidden'>) {
  try {
    window.localStorage.setItem(previousKey(userId), mode);
  } catch {
    // Storage blocked: restoring falls back to the default mode.
  }
}

/** Mode a "become visible" tap restores: the one before going invisible, else the default (community). */
export function restoreModeFor(userId: string): Exclude<PrivacyMode, 'hidden'> {
  return readPrevious(userId);
}

/**
 * One-tap "Go invisible" on the map (PATCH /me/settings privacyMode=hidden) and back to the previous
 * mode. The pill always states the current mode (icon + words), and the action below it.
 */
export function PrivacyToggle({ className }: { className?: string }) {
  const t = useTranslations();
  const me = useCurrentUser();
  const online = useOnlineStatus();
  const errorMessage = useErrorMessage();
  const settings = useUpdateSettings();
  const hidden = me.privacyMode === 'hidden';

  function toggle() {
    let next: PrivacyMode;
    if (hidden) {
      next = readPrevious(me.id);
    } else {
      writePrevious(me.id, me.privacyMode as Exclude<PrivacyMode, 'hidden'>);
      next = 'hidden';
    }
    settings.mutate(
      { privacyMode: next },
      {
        onSuccess: () =>
          notify.success(next === 'hidden' ? t('map.privacy.wentInvisible') : t('map.privacy.nowVisible', { mode: t(`privacy.${next}.title`) })),
        onError: (error) => notify.error(errorMessage(error)),
      },
    );
  }

  const Icon = hidden ? EyeOff : Eye;
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!online || settings.isPending}
      aria-pressed={hidden}
      data-testid="privacy-toggle"
      data-mode={me.privacyMode}
      className={cn(
        'flex min-h-11 max-w-full items-center gap-2.5 rounded-2xl border bg-card px-3 py-1.5 text-start shadow-md transition-colors duration-fast hover:bg-accent focus-ring disabled:opacity-60',
        hidden && 'border-warning bg-warning-soft hover:bg-warning-soft',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full',
          hidden ? 'bg-warning text-warning-foreground' : 'bg-primary-soft text-primary-soft-foreground',
        )}
      >
        <Icon className="size-[1.125rem]" />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className={cn('truncate text-xs', hidden ? 'font-semibold text-warning-soft-foreground' : 'text-muted-foreground')}>
          {hidden ? t('map.privacy.invisible') : t('map.privacy.visible', { mode: t(`privacy.${me.privacyMode}.title`) })}
        </span>
        <span className={cn('truncate text-sm font-semibold', hidden ? 'text-warning-soft-foreground' : 'text-foreground')}>
          {hidden ? t('map.privacy.becomeVisible') : t('map.privacy.goInvisible')}
        </span>
      </span>
    </button>
  );
}
