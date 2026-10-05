import { idSchema } from '@autoc/shared';
import { Errors } from '../../common/errors/api-exception';

/** Keyset position in the community listing: (memberCount desc, name asc, id asc). */
export type ListCursor = { id: string; memberCount: number; name: string };

export const encodeListCursor = (c: ListCursor): string => Buffer.from(JSON.stringify([c.memberCount, c.name, c.id])).toString('base64url');

export function decodeListCursor(cursor: string | undefined): ListCursor | null {
  if (!cursor) return null;
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(v) && Number.isInteger(v[0]) && typeof v[1] === 'string' && idSchema.safeParse(v[2]).success) {
      return { memberCount: v[0] as number, name: v[1], id: v[2] as string };
    }
  } catch {
    // fall through
  }
  throw Errors.validation('Invalid cursor', [{ path: ['cursor'], message: 'Invalid cursor' }]);
}
