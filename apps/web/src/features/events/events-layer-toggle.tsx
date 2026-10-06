'use client';

import { CalendarDays } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

const KEY = 'autoc:map-events';

/** Whether the events layer is shown on the main map (remembered per browser; on by default). */
export function useEventsLayer(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(KEY) === 'off') setOn(false);
    } catch {
      // per-viewer convenience only
    }
  }, []);
  const set = useCallback((next: boolean) => {
    setOn(next);
    try {
      window.localStorage.setItem(KEY, next ? 'on' : 'off');
    } catch {
      // ignore
    }
  }, []);
  return [on, set];
}

/** Toggle button for the events layer (pressed = shown): icon + word, never colour alone. */
export function EventsLayerToggle({ pressed, onPressedChange }: { pressed: boolean; onPressedChange: (on: boolean) => void }) {
  const t = useTranslations('events.map');
  return (
    <Button
      variant="outline"
      size="md"
      aria-pressed={pressed}
      data-testid="events-layer-toggle"
      onClick={() => onPressedChange(!pressed)}
      leadingIcon={<CalendarDays aria-hidden="true" />}
      className={cn('bg-card shadow-md', pressed && 'border-primary bg-primary-soft text-primary-soft-foreground hover:bg-primary-soft')}
    >
      <span className="max-[400px]:sr-only">{t('layer')}</span>
    </Button>
  );
}
