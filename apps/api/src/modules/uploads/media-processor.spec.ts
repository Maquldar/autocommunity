import { describe, expect, it } from 'vitest';
import { clampDuration, mediaKindFor } from './media-processor';

describe('media rules', () => {
  it('maps purposes to media kinds', () => {
    expect(mediaKindFor('avatar')).toBe('image');
    expect(mediaKindFor('order')).toBe('image');
    expect(mediaKindFor('voice')).toBe('voice');
    expect(mediaKindFor('video')).toBe('video');
  });

  it('clamps client-reported durations to the kind limit', () => {
    expect(clampDuration('voice', 999)).toBe(180);
    expect(clampDuration('voice', -3)).toBe(0);
    expect(clampDuration('voice', 12.345)).toBe(12.3);
    expect(clampDuration('video', 10_000)).toBe(600);
    expect(clampDuration('voice', undefined)).toBeNull();
    expect(clampDuration('image', 10)).toBeNull();
  });
});
