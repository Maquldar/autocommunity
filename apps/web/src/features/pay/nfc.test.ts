import { describe, expect, it, vi } from 'vitest';
import { createNfcAdapter, payTagFromMessage, simulatedTag, type NdefReadingEvent } from './nfc';

const TAG = 'AAemuo9fEPBDM5rlccI5U0';
const enc = (text: string) => new DataView(new TextEncoder().encode(text).buffer);
const urlEvent = (url: string): NdefReadingEvent => ({ message: { records: [{ recordType: 'url', data: enc(url) }] } });

class FakeReader {
  static last: FakeReader | null = null;
  onreading: ((e: NdefReadingEvent) => void) | null = null;
  onreadingerror: ((e: unknown) => void) | null = null;
  scan = vi.fn(async () => undefined);
  constructor() {
    FakeReader.last = this;
  }
}

describe('NFC adapter', () => {
  it('is unsupported without NDEFReader (iOS, desktop)', () => {
    expect(createNfcAdapter({}).supported).toBe(false);
    expect(createNfcAdapter(undefined).supported).toBe(false);
  });

  it('reads the payTag from a URL record and reports other stickers and read errors', async () => {
    const adapter = createNfcAdapter({ NDEFReader: FakeReader });
    expect(adapter.supported).toBe(true);
    const onTag = vi.fn();
    const onForeign = vi.fn();
    const onReadError = vi.fn();
    const ctrl = new AbortController();
    await adapter.start({ onTag, onForeign, onReadError }, ctrl.signal);
    const reader = FakeReader.last!;
    expect(reader.scan).toHaveBeenCalledWith({ signal: ctrl.signal });
    reader.onreading!(urlEvent(`https://autocommunity.example/pay/t/${TAG}`));
    expect(onTag).toHaveBeenCalledWith(TAG);
    reader.onreading!(urlEvent('https://example.com/menu'));
    expect(onForeign).toHaveBeenCalledTimes(1);
    reader.onreadingerror!({});
    expect(onReadError).toHaveBeenCalledTimes(1);
    ctrl.abort();
    reader.onreading!(urlEvent(`https://x/pay/t/${TAG}`));
    expect(onTag).toHaveBeenCalledTimes(1);
  });

  it('accepts text records with a bare tag and ignores media records', () => {
    expect(payTagFromMessage({ message: { records: [{ recordType: 'mime', mediaType: 'application/json', data: enc('{}') }, { recordType: 'text', encoding: 'utf-8', data: enc(TAG) }] } })).toBe(TAG);
    expect(payTagFromMessage({ message: { records: [] } })).toBeNull();
  });
});

describe('simulated tag (dev / demo only)', () => {
  const q = new URLSearchParams(`simulateTag=${TAG}`);
  it('works outside production and in demo mode only', () => {
    expect(simulatedTag(q, { nodeEnv: 'development' })).toBe(TAG);
    expect(simulatedTag(q, { nodeEnv: 'production', demoMode: 'true' })).toBe(TAG);
    expect(simulatedTag(q, { nodeEnv: 'production' })).toBeNull();
    expect(simulatedTag(new URLSearchParams('simulateTag=<x>'), { nodeEnv: 'development' })).toBeNull();
    expect(simulatedTag(null, { nodeEnv: 'development' })).toBeNull();
  });
});
