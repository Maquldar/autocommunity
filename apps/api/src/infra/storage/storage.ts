import { randomBytes } from 'node:crypto';

export abstract class Storage {
  constructor(protected readonly publicBaseUrl: string) {}

  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;
  abstract delete(key: string): Promise<void>;

  publicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }
}

const KEY_RE = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_.-]*)*$/;

/** Object keys are always server-generated; this guards against traversal if that ever changes. */
export function assertSafeKey(key: string): void {
  if (!KEY_RE.test(key) || key.includes('..')) throw new Error(`Unsafe storage key: ${key}`);
}

/** Random, unguessable key: `<prefix>/<yyyy>/<mm>/<32 hex chars>`; callers append suffix + extension. */
export function randomKeyBase(prefix: string, now = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${prefix}/${yyyy}/${mm}/${randomBytes(16).toString('hex')}`;
}
