import type { NotificationDto, SosDto, SosType } from '@autoc/shared';
import { SOS_TYPES } from '@autoc/shared';

/**
 * Urgent "someone nearby needs help" alerts. Dispatch sends both a socket `sos:new` and a `sos_nearby`
 * notification for the same SOS, so alerts are keyed by SOS id. A tiny external store (no React state)
 * so the realtime handlers can push from outside the component tree.
 */
export type SosAlert = { sosId: string; type: SosType; distanceM: number | null; requesterName: string | null; at: number };

type Listener = () => void;

export function createSosAlertStore(max = 3) {
  let alerts: SosAlert[] = [];
  const dismissed = new Set<string>();
  const listeners = new Set<Listener>();
  const emit = () => listeners.forEach((l) => l());

  return {
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => alerts,
    /** Adds (or refreshes) an alert; ignored once the user dismissed or opened that SOS. */
    push(alert: SosAlert) {
      if (dismissed.has(alert.sosId)) return;
      const existing = alerts.find((a) => a.sosId === alert.sosId);
      const merged: SosAlert = existing
        ? {
            ...existing,
            distanceM: alert.distanceM ?? existing.distanceM,
            requesterName: alert.requesterName ?? existing.requesterName,
          }
        : alert;
      alerts = [merged, ...alerts.filter((a) => a.sosId !== alert.sosId)].slice(0, max);
      emit();
    },
    dismiss(sosId: string) {
      dismissed.add(sosId);
      if (!alerts.some((a) => a.sosId === sosId)) return;
      alerts = alerts.filter((a) => a.sosId !== sosId);
      emit();
    },
    /** The SOS ended or is no longer for us: drop the alert without remembering a dismissal. */
    remove(sosId: string) {
      if (!alerts.some((a) => a.sosId === sosId)) return;
      alerts = alerts.filter((a) => a.sosId !== sosId);
      emit();
    },
    clear() {
      alerts = [];
      dismissed.clear();
      emit();
    },
  };
}

export const sosAlertStore = createSosAlertStore();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function alertFromSos(sos: SosDto, now = Date.now()): SosAlert {
  return { sosId: sos.id, type: sos.type, distanceM: sos.distanceM, requesterName: sos.requester.name || sos.requester.nickname, at: now };
}

/** `sos_nearby` payload `{ sosId, type, distanceM, requester: UserMini }` → alert (null if malformed). */
export function alertFromNotification(notification: Pick<NotificationDto, 'type' | 'payload'>, now = Date.now()): SosAlert | null {
  if (notification.type !== 'sos_nearby' || !isRecord(notification.payload)) return null;
  const { sosId, type, distanceM, requester } = notification.payload;
  if (typeof sosId !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(sosId)) return null;
  const sosType = typeof type === 'string' && (SOS_TYPES as readonly string[]).includes(type) ? (type as SosType) : 'other';
  const name = isRecord(requester) ? (typeof requester.name === 'string' && requester.name) || (typeof requester.nickname === 'string' ? requester.nickname : null) : null;
  return {
    sosId,
    type: sosType,
    distanceM: typeof distanceM === 'number' && Number.isFinite(distanceM) ? distanceM : null,
    requesterName: name || null,
    at: now,
  };
}
