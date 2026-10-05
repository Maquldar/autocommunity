import { describe, expect, it, vi } from 'vitest';
import { createVoiceRecorder, pickVoiceMimeType, type RecorderDeps, type RecorderState } from './voice-recorder';

/** Fake MediaRecorder: records what happened and lets the test drive data + stop events. */
class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static supported = new Set(['audio/webm;codecs=opus', 'audio/webm']);
  static isTypeSupported = (type: string) => FakeRecorder.supported.has(type);
  state = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(
    public stream: MediaStream,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? '';
    FakeRecorder.instances.push(this);
  }
  start = vi.fn(() => {
    this.state = 'recording';
  });
  stop = vi.fn(() => {
    this.state = 'inactive';
    // Real recorders flush a last chunk, then fire stop asynchronously.
    this.ondataavailable?.({ data: new Blob(['audio'], { type: this.mimeType }) });
    queueMicrotask(() => this.onstop?.());
  });
}

function fakeStream() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

function setup(over: Partial<RecorderDeps> = {}) {
  FakeRecorder.instances = [];
  let now = 0;
  let tick: (() => void) | null = null;
  const { stream, track } = fakeStream();
  const states: RecorderState[] = [];
  const onComplete = vi.fn();
  const deps: RecorderDeps = {
    getUserMedia: vi.fn(async () => stream),
    MediaRecorder: FakeRecorder as unknown as RecorderDeps['MediaRecorder'],
    now: () => now,
    setInterval: (fn) => {
      tick = fn;
      return 1;
    },
    clearInterval: () => {
      tick = null;
    },
    ...over,
  };
  const recorder = createVoiceRecorder(deps, { onChange: (s) => states.push(s), onComplete });
  return {
    recorder,
    states,
    onComplete,
    track,
    deps,
    advance(ms: number) {
      now += ms;
      tick?.();
    },
    hasTicker: () => tick !== null,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('pickVoiceMimeType', () => {
  it('prefers WebM/Opus and falls back in order', () => {
    expect(pickVoiceMimeType((t) => t === 'audio/webm;codecs=opus' || t === 'audio/mp4')).toBe('audio/webm;codecs=opus');
    expect(pickVoiceMimeType((t) => t === 'audio/mp4')).toBe('audio/mp4');
    expect(pickVoiceMimeType(() => false)).toBeUndefined();
    expect(pickVoiceMimeType(undefined)).toBeUndefined();
  });
});

describe('voice recorder state machine', () => {
  it('idle → requesting → recording (timer) → stop → idle with the recording', async () => {
    const t = setup();
    await t.recorder.start();
    expect(t.states.map((s) => s.status)).toEqual(['requesting', 'recording']);
    expect(FakeRecorder.instances[0]!.mimeType).toBe('audio/webm;codecs=opus');
    expect(FakeRecorder.instances[0]!.start).toHaveBeenCalled();

    t.advance(2_500);
    expect(t.recorder.getState()).toEqual({ status: 'recording', elapsedSec: 2.5 });

    t.recorder.stop();
    await flush();
    expect(t.recorder.getState()).toEqual({ status: 'idle' });
    expect(t.onComplete).toHaveBeenCalledTimes(1);
    const voice = t.onComplete.mock.calls[0]![0];
    expect(voice.durationSec).toBe(2.5);
    expect(voice.mimeType).toBe('audio/webm;codecs=opus');
    expect(voice.blob.size).toBeGreaterThan(0);
    expect(t.track.stop).toHaveBeenCalled(); // microphone released
    expect(t.hasTicker()).toBe(false);
  });

  it('cancel discards the recording and releases the microphone', async () => {
    const t = setup();
    await t.recorder.start();
    t.advance(5_000);
    t.recorder.cancel();
    await flush();
    expect(t.recorder.getState().status).toBe('idle');
    expect(t.onComplete).not.toHaveBeenCalled();
    expect(t.track.stop).toHaveBeenCalled();
  });

  it('stops by itself at the 3-minute limit and completes with 180 s', async () => {
    const t = setup();
    await t.recorder.start();
    t.advance(60_000);
    t.advance(60_000);
    t.advance(61_000);
    await flush();
    expect(t.recorder.getState().status).toBe('idle');
    expect(t.onComplete.mock.calls[0]![0].durationSec).toBe(180);
  });

  it('drops accidental taps shorter than half a second', async () => {
    const t = setup();
    await t.recorder.start();
    t.advance(200);
    t.recorder.stop();
    await flush();
    expect(t.onComplete).not.toHaveBeenCalled();
  });

  it('denied microphone → error "denied"; unsupported browser → error "unsupported"', async () => {
    const denied = setup({
      getUserMedia: vi.fn(async () => {
        throw Object.assign(new Error('no'), { name: 'NotAllowedError' });
      }),
    });
    await denied.recorder.start();
    expect(denied.recorder.getState()).toEqual({ status: 'error', error: 'denied' });
    denied.recorder.cancel();
    expect(denied.recorder.getState()).toEqual({ status: 'idle' });

    const unsupported = setup({ MediaRecorder: null });
    await unsupported.recorder.start();
    expect(unsupported.recorder.getState()).toEqual({ status: 'error', error: 'unsupported' });
  });

  it('cancel while the permission prompt is open never starts recording', async () => {
    let grant: (stream: MediaStream) => void = () => undefined;
    const { stream, track } = fakeStream();
    const t = setup({ getUserMedia: vi.fn(() => new Promise<MediaStream>((resolve) => (grant = resolve))) });
    const started = t.recorder.start();
    expect(t.recorder.getState().status).toBe('requesting');
    t.recorder.cancel();
    grant(stream);
    await started;
    expect(t.recorder.getState().status).toBe('idle');
    expect(FakeRecorder.instances).toHaveLength(0);
    expect(track.stop).toHaveBeenCalled();
  });

  it('a second start while recording is ignored', async () => {
    const t = setup();
    await t.recorder.start();
    await t.recorder.start();
    expect(FakeRecorder.instances).toHaveLength(1);
  });
});
