import { idSchema } from '@autoc/shared';
import { Errors } from '../errors/api-exception';

/** Keyset position: rows are ordered by (createdAt DESC, id DESC). */
export type CursorKey = { createdAt: Date; id: string };

export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify([key.createdAt.toISOString(), key.id])).toString('base64url');
}

/** Returns null for a missing cursor; throws VALIDATION_ERROR for a malformed one. */
export function decodeCursor(cursor: string | undefined | null): CursorKey | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
      const createdAt = new Date(parsed[0]);
      if (!Number.isNaN(createdAt.getTime()) && idSchema.safeParse(parsed[1]).success) {
        return { createdAt, id: parsed[1] };
      }
    }
  } catch {
    // fall through to the validation error
  }
  throw Errors.validation('Invalid cursor', [{ path: ['cursor'], message: 'Invalid cursor' }]);
}

/** Prisma `where` fragment selecting rows strictly after the cursor in (createdAt DESC, id DESC) order. */
export function keysetWhere(cursor: CursorKey | null) {
  if (!cursor) return {};
  return {
    OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }],
  };
}

export const keysetOrderBy = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

/**
 * Splits rows fetched with `take: limit + 1` into the page and the next cursor.
 * `keyOf` maps a row to its keyset position (defaults to the row's own createdAt/id).
 */
export function splitPage<Row>(
  rows: Row[],
  limit: number,
  keyOf: (row: Row) => CursorKey = (row) => row as unknown as CursorKey,
): { rows: Row[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  return { rows: pageRows, nextCursor: hasMore && last ? encodeCursor(keyOf(last)) : null };
}
