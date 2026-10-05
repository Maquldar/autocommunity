import { idSchema } from '@autoc/shared';
import { Errors } from '../../common/errors/api-exception';

/**
 * Keyset positions for GET /services. Distance sort: (distance ASC, id ASC); rating sort:
 * (rating DESC, reviewCount DESC, id DESC). The sort kind is part of the cursor so a cursor from one
 * sort can't be replayed against the other.
 */
export type ServiceCursor =
  | { sort: 'distance'; distance: number; id: string }
  | { sort: 'rating'; rating: number; reviewCount: number; id: string };

export function encodeServiceCursor(c: ServiceCursor): string {
  const tuple = c.sort === 'distance' ? ['d', c.distance, c.id] : ['r', c.rating, c.reviewCount, c.id];
  return Buffer.from(JSON.stringify(tuple)).toString('base64url');
}

const invalid = () => Errors.validation('Invalid cursor', [{ path: ['cursor'], message: 'Invalid cursor' }]);

export function decodeServiceCursor(cursor: string | undefined, sort: ServiceCursor['sort']): ServiceCursor | null {
  if (!cursor) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (!Array.isArray(parsed)) throw invalid();
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const isId = (v: unknown): v is string => typeof v === 'string' && idSchema.safeParse(v).success;
  if (sort === 'distance' && parsed.length === 3 && parsed[0] === 'd' && isNum(parsed[1]) && isId(parsed[2])) {
    return { sort, distance: parsed[1], id: parsed[2] };
  }
  if (
    sort === 'rating' &&
    parsed.length === 4 &&
    parsed[0] === 'r' &&
    isNum(parsed[1]) &&
    Number.isInteger(parsed[2]) &&
    isId(parsed[3])
  ) {
    return { sort, rating: parsed[1], reviewCount: parsed[2] as number, id: parsed[3] };
  }
  throw invalid();
}
