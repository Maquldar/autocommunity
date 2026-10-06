import { describe, expect, it } from 'vitest';
import { logUrl } from './logger';

describe('logUrl', () => {
  it('drops the query string and redacts share tokens', () => {
    expect(logUrl('/api/v1/feed?q=secret')).toBe('/api/v1/feed');
    expect(logUrl('/api/v1/public/sos/AbC-123_xyz')).toBe('/api/v1/public/sos/[redacted]');
    expect(logUrl('/api/v1/public/sos/AbC-123_xyz?x=1')).toBe('/api/v1/public/sos/[redacted]');
    expect(logUrl('/s/AbC-123_xyz')).toBe('/s/[redacted]');
    expect(logUrl('/api/v1/sos/0192a6c5-1234-7abc-8def-0123456789ab')).toBe('/api/v1/sos/0192a6c5-1234-7abc-8def-0123456789ab');
  });
});
