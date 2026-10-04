#!/usr/bin/env node
// Creates local env files from the examples with fresh random secrets. Cross-platform (no bash needed).
// Safe to re-run: existing files are never overwritten.
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const secret = () => randomBytes(32).toString('base64url');

function create(example, target, transform = (s) => s) {
  const from = join(root, example);
  const to = join(root, target);
  if (existsSync(to)) {
    console.log(`✓ ${target} already exists, left unchanged`);
    return;
  }
  copyFileSync(from, to);
  writeFileSync(to, transform(readFileSync(to, 'utf8')));
  console.log(`✓ created ${target}`);
}

create('apps/api/.env.example', 'apps/api/.env', (s) =>
  s
    .replace(/^JWT_ACCESS_SECRET=.*$/m, `JWT_ACCESS_SECRET=${secret()}`)
    .replace(/^OTP_SECRET=.*$/m, `OTP_SECRET=${secret()}`),
);
create('apps/web/.env.example', 'apps/web/.env.local');

console.log('\nNext: pnpm db:migrate && pnpm db:seed && pnpm dev   (see README "Run locally")');
