'use client';

import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { isApiError } from '@/lib/api/errors';
import { detectPushSupport, disablePush, enablePush, getCurrentSubscription, PushError, type PushSupport } from '@/lib/push/push';
import { notify } from '@/lib/toast';

type Problem = 'denied' | 'not-configured' | null;

/**
 * "Push notifications" switch. Permission is requested only when the user turns it on. iOS Safari
 * outside the installed app gets the Add to Home Screen explanation instead of a dead switch.
 */
export function PushRow() {
  const t = useTranslations('settings.push');
  const errorMessage = useErrorMessage();
  const online = useOnlineStatus();
  const id = useId();
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);

  useEffect(() => {
    const detected = detectPushSupport();
    setSupport(detected);
    if (detected !== 'supported') return;
    if (Notification.permission === 'denied') setProblem('denied');
    void getCurrentSubscription()
      .then((subscription) => setEnabled(Boolean(subscription) && Notification.permission === 'granted'))
      .catch(() => setEnabled(false));
  }, []);

  async function toggle(next: boolean) {
    setBusy(true);
    setProblem(null);
    try {
      if (next) {
        await enablePush();
        setEnabled(true);
        notify.success(t('enabled'));
      } else {
        await disablePush();
        setEnabled(false);
        notify.success(t('disabled'));
      }
    } catch (error) {
      if (error instanceof PushError) {
        if (error.reason === 'denied') setProblem('denied');
        else if (error.reason === 'not-configured') setProblem('not-configured');
        else setSupport('unsupported');
      } else {
        notify.error(isApiError(error) ? errorMessage(error) : t('failed'));
      }
    } finally {
      setBusy(false);
    }
  }

  const note =
    support === 'ios-needs-install'
      ? t('iosInstall')
      : support === 'unsupported'
        ? t('unsupported')
        : problem === 'denied'
          ? t('denied')
          : problem === 'not-configured'
            ? t('notConfigured')
            : null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4" data-testid="push-row">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Label htmlFor={id} className="text-[0.9375rem]">
            {t('label')}
          </Label>
          <p id={`${id}-hint`} className="text-sm text-muted-foreground">
            {t('hint')}
          </p>
        </div>
        <Switch
          id={id}
          checked={enabled}
          onCheckedChange={(next) => void toggle(next)}
          disabled={support !== 'supported' || busy || !online}
          aria-busy={busy || undefined}
          aria-describedby={`${id}-hint${note ? ` ${id}-note` : ''}`}
        />
      </div>
      {note ? (
        <p id={`${id}-note`} role="status" className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {note}
        </p>
      ) : null}
    </div>
  );
}
