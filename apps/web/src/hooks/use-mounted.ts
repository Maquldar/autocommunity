'use client';

import { useSyncExternalStore } from 'react';

const noop = () => () => {};

/** False during SSR and hydration, true afterwards. For UI that depends on client-only state (theme). */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
