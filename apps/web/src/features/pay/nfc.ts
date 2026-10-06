import { extractPayTag } from '@autoc/shared';

/**
 * A tiny adapter over Web NFC (`NDEFReader`, Chrome on Android only), so the scanner screen can be unit
 * tested with a fake reader and shows the QR / manual fallbacks everywhere else (iOS, desktop).
 */

type NdefRecordLike = { recordType: string; mediaType?: string; encoding?: string; data?: DataView | ArrayBuffer | null };
export type NdefReadingEvent = { serialNumber?: string; message: { records: readonly NdefRecordLike[] } };
type NdefReaderLike = {
  scan: (options?: { signal?: AbortSignal }) => Promise<void>;
  onreading: ((event: NdefReadingEvent) => void) | null;
  onreadingerror: ((event: unknown) => void) | null;
};
export type NdefReaderCtor = new () => NdefReaderLike;

export type NfcScanHandlers = {
  /** A sticker with a payTag was read. */
  onTag: (tag: string) => void;
  /** A tag was read but carried no payTag (another sticker, a bank card…). */
  onForeign?: () => void;
  /** Reading failed (moved away too fast, unreadable). The scan keeps running. */
  onReadError?: () => void;
};

export type NfcAdapter = {
  supported: boolean;
  /** Starts scanning; resolves once the browser granted NFC access. Abort the signal to stop. */
  start: (handlers: NfcScanHandlers, signal: AbortSignal) => Promise<void>;
};

const readerCtor = (scope: unknown): NdefReaderCtor | null => {
  const g = scope as { NDEFReader?: NdefReaderCtor } | undefined;
  return g && typeof g.NDEFReader === 'function' ? g.NDEFReader : null;
};

/** The text inside one NDEF record (URL or text records), or null. */
export function recordText(record: NdefRecordLike): string | null {
  if (!record.data) return null;
  if (record.recordType !== 'url' && record.recordType !== 'absolute-url' && record.recordType !== 'text') return null;
  try {
    const view = record.data instanceof DataView ? record.data : new DataView(record.data);
    return new TextDecoder(record.encoding || 'utf-8').decode(view);
  } catch {
    return null;
  }
}

/** The first payTag in a read NDEF message (a `…/pay/t/<tag>` URL record, or a text record with the tag). */
export function payTagFromMessage(event: NdefReadingEvent): string | null {
  for (const record of event.message.records) {
    const text = recordText(record);
    const tag = text ? extractPayTag(text) : null;
    if (tag) return tag;
  }
  return null;
}

export function createNfcAdapter(scope: unknown = typeof window === 'undefined' ? undefined : window): NfcAdapter {
  const Ctor = readerCtor(scope);
  return {
    supported: Ctor !== null,
    async start(handlers, signal) {
      if (!Ctor) throw new Error('Web NFC is not supported');
      const reader = new Ctor();
      reader.onreading = (event) => {
        if (signal.aborted) return;
        const tag = payTagFromMessage(event);
        if (tag) handlers.onTag(tag);
        else handlers.onForeign?.();
      };
      reader.onreadingerror = () => {
        if (!signal.aborted) handlers.onReadError?.();
      };
      await reader.scan({ signal });
    },
  };
}

/**
 * Dev / demo only: `?simulateTag=<payTag>` acts as if that sticker was tapped, so screenshots and e2e can
 * show the "tag detected" state. Off in production builds unless NEXT_PUBLIC_DEMO_MODE=true.
 */
export function simulatedTag(search: URLSearchParams | null, env: { nodeEnv?: string; demoMode?: string } = { nodeEnv: process.env.NODE_ENV, demoMode: process.env.NEXT_PUBLIC_DEMO_MODE }): string | null {
  if (env.nodeEnv === 'production' && env.demoMode !== 'true') return null;
  const raw = search?.get('simulateTag');
  return raw ? extractPayTag(raw) : null;
}
