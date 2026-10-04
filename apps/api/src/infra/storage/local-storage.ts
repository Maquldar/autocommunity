import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Storage, assertSafeKey } from './storage';

/** Files on local disk under `root`, served by the API at /media (see bootstrap). */
export class LocalStorage extends Storage {
  readonly root: string;

  constructor(root: string, publicBaseUrl: string) {
    super(publicBaseUrl);
    this.root = resolve(root);
  }

  async put(key: string, body: Buffer): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    // Write-then-rename so readers never see a partially written file.
    const tmp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, target);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  pathFor(key: string): string {
    assertSafeKey(key);
    return join(this.root, key);
  }
}
