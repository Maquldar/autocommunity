import { LIMITS } from '@autoc/shared';

/**
 * Voice message recorder (MediaRecorder, WebM/Opus where supported, else what the browser offers).
 *
 *   idle ──start──▶ requesting ──granted──▶ recording ──stop──▶ idle (+ onComplete)
 *                       │  denied/unsupported ──▶ error ──start──▶ requesting …
 *                       └─cancel──▶ idle                recording ──cancel──▶ idle (discarded)
 *   recording reaches maxSec ──▶ stops by itself and completes.
 *
 * All browser APIs are injected so the state machine is unit-tested with a fake MediaRecorder.
 */

export type RecorderError = 'unsupported' | 'denied' | 'failed';

export type RecorderState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'recording'; elapsedSec: number }
  | { status: 'error'; error: RecorderError };

export type RecordedVoice = { blob: Blob; durationSec: number; mimeType: string };

type RecorderLike = {
  state: string;
  mimeType?: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  start: (timeslice?: number) => void;
  stop: () => void;
};

type RecorderCtor = {
  new (stream: MediaStream, options?: { mimeType?: string }): RecorderLike;
  isTypeSupported?: (type: string) => boolean;
};

export type RecorderDeps = {
  getUserMedia: ((constraints: MediaStreamConstraints) => Promise<MediaStream>) | null;
  MediaRecorder: RecorderCtor | null;
  now: () => number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  maxSec?: number;
  /** Recordings shorter than this are treated as accidental taps and dropped. */
  minSec?: number;
};

export const VOICE_MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

export function pickVoiceMimeType(isTypeSupported: ((type: string) => boolean) | undefined): string | undefined {
  if (!isTypeSupported) return undefined;
  return VOICE_MIME_CANDIDATES.find((type) => {
    try {
      return isTypeSupported(type);
    } catch {
      return false;
    }
  });
}

export function browserRecorderDeps(): RecorderDeps {
  const hasWindow = typeof window !== 'undefined';
  const media = hasWindow ? navigator.mediaDevices : undefined;
  return {
    getUserMedia: media?.getUserMedia ? (c) => media.getUserMedia(c) : null,
    MediaRecorder: hasWindow && 'MediaRecorder' in window ? (window.MediaRecorder as unknown as RecorderCtor) : null,
    now: () => Date.now(),
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (handle) => window.clearInterval(handle as number),
  };
}

export function createVoiceRecorder(
  deps: RecorderDeps,
  callbacks: { onChange: (state: RecorderState) => void; onComplete: (voice: RecordedVoice) => void },
) {
  const maxSec = deps.maxSec ?? LIMITS.voiceMaxSec;
  const minSec = deps.minSec ?? 0.5;
  let state: RecorderState = { status: 'idle' };
  let stream: MediaStream | null = null;
  let recorder: RecorderLike | null = null;
  let chunks: Blob[] = [];
  let startedAt = 0;
  let ticker: unknown = null;
  let outcome: 'send' | 'discard' = 'discard';
  let session = 0;

  const set = (next: RecorderState) => {
    state = next;
    callbacks.onChange(next);
  };

  const elapsed = () => Math.min(maxSec, Math.max(0, (deps.now() - startedAt) / 1000));

  function releaseStream() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  function finish(mimeType: string | undefined) {
    if (ticker !== null) deps.clearInterval(ticker);
    ticker = null;
    const durationSec = Math.round(elapsed() * 10) / 10;
    const parts = chunks;
    chunks = [];
    recorder = null;
    releaseStream();
    set({ status: 'idle' });
    if (outcome === 'send' && parts.length > 0 && durationSec >= minSec) {
      const type = mimeType || parts[0]?.type || 'audio/webm';
      callbacks.onComplete({ blob: new Blob(parts, { type }), durationSec, mimeType: type });
    }
  }

  return {
    getState: () => state,

    async start(): Promise<void> {
      if (state.status === 'requesting' || state.status === 'recording') return;
      const Ctor = deps.MediaRecorder;
      if (!Ctor || !deps.getUserMedia) {
        set({ status: 'error', error: 'unsupported' });
        return;
      }
      const mine = ++session;
      set({ status: 'requesting' });
      let granted: MediaStream;
      try {
        granted = await deps.getUserMedia({ audio: true });
      } catch (error) {
        if (mine !== session) return;
        const name = (error as { name?: string } | null)?.name;
        set({ status: 'error', error: name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'failed' });
        return;
      }
      // Cancelled while the permission prompt was open.
      if (mine !== session || (state as RecorderState).status !== 'requesting') {
        granted.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = granted;
      const mimeType = pickVoiceMimeType(Ctor.isTypeSupported?.bind(Ctor));
      try {
        recorder = new Ctor(granted, mimeType ? { mimeType } : undefined);
      } catch {
        releaseStream();
        set({ status: 'error', error: 'failed' });
        return;
      }
      chunks = [];
      outcome = 'send';
      const active = recorder;
      active.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      active.onstop = () => finish(active.mimeType || mimeType);
      startedAt = deps.now();
      active.start(250);
      set({ status: 'recording', elapsedSec: 0 });
      ticker = deps.setInterval(() => {
        if (state.status !== 'recording') return;
        const sec = elapsed();
        if (sec >= maxSec) {
          outcome = 'send';
          if (recorder && recorder.state !== 'inactive') recorder.stop();
          return;
        }
        set({ status: 'recording', elapsedSec: sec });
      }, 200);
    },

    /** Stops and delivers the recording through `onComplete`. */
    stop() {
      if (state.status !== 'recording' || !recorder) return;
      outcome = 'send';
      if (recorder.state !== 'inactive') recorder.stop();
    },

    /** Stops and throws the recording away (also aborts a pending permission request). */
    cancel() {
      if (state.status === 'requesting') {
        session += 1;
        set({ status: 'idle' });
        return;
      }
      if (state.status === 'error') {
        set({ status: 'idle' });
        return;
      }
      if (state.status !== 'recording' || !recorder) return;
      outcome = 'discard';
      if (recorder.state !== 'inactive') recorder.stop();
    },

    dispose() {
      session += 1;
      outcome = 'discard';
      if (ticker !== null) deps.clearInterval(ticker);
      ticker = null;
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        recorder.stop();
      }
      recorder = null;
      chunks = [];
      releaseStream();
    },
  };
}

export type VoiceRecorder = ReturnType<typeof createVoiceRecorder>;
