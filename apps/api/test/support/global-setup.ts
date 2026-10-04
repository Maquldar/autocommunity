import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Applies migrations to the test database once per run. */
export default function setup(): void {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? 'postgresql://autoc:autoc@localhost:5432/autoc_test';
  execFileSync(resolve(__dirname, '../../node_modules/.bin/prisma'), ['migrate', 'deploy'], {
    cwd: resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
  rmSync(join(tmpdir(), 'autoc-api-test-uploads'), { recursive: true, force: true });
}
