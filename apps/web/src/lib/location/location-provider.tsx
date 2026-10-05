'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { createLocationSharer, type Fix, type LocationSharer, type SharerStatus } from './location-sharer';

/** Per-user flags in localStorage. Every access is wrapped: storage can be blocked (private mode, policies). */
const consentKey = (userId: string) => `autoc:location-consent:${userId}`;
const dismissKey = (userId: string) => `autoc:location-banner-dismissed:${userId}`;

export function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function writeFlag(key: string, value: boolean): void {
  try {
    if (value) window.localStorage.setItem(key, '1');
    else window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable: the choice lasts for this page load only.
  }
}

type LocationContextValue = {
  status: SharerStatus;
  position: Fix | null;
  /** The user tapped "Share my location" at some point (stored per user). */
  consented: boolean;
  /** The user closed the explanation banner ("Not now"). */
  dismissed: boolean;
  enable: () => void;
  disable: () => Promise<void>;
  dismiss: () => void;
};

const LocationContext = createContext<LocationContextValue | null>(null);

async function permissionState(): Promise<PermissionState | null> {
  try {
    if (!navigator.permissions?.query) return null;
    const result = await navigator.permissions.query({ name: 'geolocation' });
    return result.state;
  } catch {
    return null;
  }
}

/**
 * App-wide foreground location sharing for the signed-in user (SPEC A-4). Nothing touches the
 * Geolocation API until the user has tapped "Share my location" once; after that, sharing resumes on
 * every visit while the browser permission stays granted.
 */
export function LocationProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [status, setStatus] = useState<SharerStatus>('off');
  const [position, setPosition] = useState<Fix | null>(null);
  const [consented, setConsented] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const sharerRef = useRef<LocationSharer | null>(null);

  useEffect(() => {
    const sharer = createLocationSharer({
      geolocation: 'geolocation' in navigator ? navigator.geolocation : null,
      visibility: document,
      send: (fix) => api.location.update(fix),
      onChange: (state) => {
        setStatus(state.status);
        setPosition(state.position);
      },
    });
    sharerRef.current = sharer;

    const hasConsent = readFlag(consentKey(userId));
    setConsented(hasConsent);
    setDismissed(readFlag(dismissKey(userId)));
    let cancelled = false;
    if (hasConsent) {
      void permissionState().then((state) => {
        if (cancelled) return;
        // `prompt` means the permission was reset: wait for another explicit tap instead of prompting.
        if (state === 'denied') setStatus('denied');
        else if (state !== 'prompt') sharer.start();
      });
    }
    return () => {
      cancelled = true;
      sharer.stop();
      sharerRef.current = null;
    };
  }, [userId]);

  const enable = useCallback(() => {
    writeFlag(consentKey(userId), true);
    setConsented(true);
    sharerRef.current?.start();
  }, [userId]);

  const disable = useCallback(async () => {
    writeFlag(consentKey(userId), false);
    setConsented(false);
    sharerRef.current?.stop();
    await api.location.remove();
  }, [userId]);

  const dismiss = useCallback(() => {
    writeFlag(dismissKey(userId), true);
    setDismissed(true);
  }, [userId]);

  const value = useMemo(
    () => ({ status, position, consented, dismissed, enable, disable, dismiss }),
    [status, position, consented, dismissed, enable, disable, dismiss],
  );
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocationSharing(): LocationContextValue {
  const value = useContext(LocationContext);
  if (!value) throw new Error('useLocationSharing must be used inside <LocationProvider>');
  return value;
}
