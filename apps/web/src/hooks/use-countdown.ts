'use client';

import { useEffect, useState } from 'react';

function secondsUntil(deadline: number | null): number {
  return deadline === null ? 0 : Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

/** Whole seconds left until `deadline` (epoch ms), ticking once per second; 0 when passed or null. */
export function useCountdown(deadline: number | null): number {
  const [seconds, setSeconds] = useState(() => secondsUntil(deadline));

  useEffect(() => {
    setSeconds(secondsUntil(deadline));
    if (deadline === null) return undefined;
    const timer = window.setInterval(() => {
      const next = secondsUntil(deadline);
      setSeconds(next);
      if (next === 0) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);

  return seconds;
}
