import { describe, expect, it } from 'vitest';
import { ApiException } from '../errors/api-exception';
import { decodeCursor, encodeCursor, keysetWhere, splitPage } from './cursor';

const id = '0192a6c5-1234-7abc-8def-0123456789ab';

describe('cursor', () => {
  it('round-trips createdAt and id as an opaque base64url string', () => {
    const key = { createdAt: new Date('2026-10-04T10:00:00.123Z'), id };
    const c = encodeCursor(key);
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(c)).toEqual(key);
  });

  it('returns null for an absent cursor', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it.each([
    'not-base64-json',
    Buffer.from('{"a":1}').toString('base64url'),
    Buffer.from('["nope","x"]').toString('base64url'),
    Buffer.from(`["2026-10-04T10:00:00Z","not-a-uuid"]`).toString('base64url'),
  ])('rejects malformed cursor %s with VALIDATION_ERROR', (c) => {
    try {
      decodeCursor(c);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiException);
      expect((err as ApiException).code).toBe('VALIDATION_ERROR');
    }
  });

  it('builds a keyset predicate', () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    expect(keysetWhere(null)).toEqual({});
    expect(keysetWhere({ createdAt, id })).toEqual({
      OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }],
    });
  });

  it('splits limit+1 rows into a page and a cursor for the last item', () => {
    const rows = [1, 2, 3].map((n) => ({ createdAt: new Date(2026, 0, n), id }));
    const page = splitPage(rows, 2);
    expect(page.rows).toHaveLength(2);
    expect(decodeCursor(page.nextCursor)).toEqual(rows[1]);
    expect(splitPage(rows, 3).nextCursor).toBeNull();
  });
});
