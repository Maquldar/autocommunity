import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Loads public/sw.js with a stub worker scope and hands back its internal `safeUrl`. */
function loadSafeUrl(): (value: unknown) => string {
  const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8') // vitest runs from apps/web;
  const scope = { addEventListener: () => undefined, location: { origin: 'https://app.example' } };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- test harness for a plain service-worker script
  return new Function('self', 'clients', `${source}\nreturn safeUrl;`)(scope, {}) as (value: unknown) => string;
}

describe('sw.js safeUrl', () => {
  const safeUrl = loadSafeUrl();

  it('keeps same-origin paths', () => {
    expect(safeUrl('/posts/abc?x=1#c')).toBe('/posts/abc?x=1#c');
    expect(safeUrl('/')).toBe('/');
  });

  it('rejects anything that could leave the origin', () => {
    for (const bad of [
      '//evil.com',
      '/\\evil.com',
      '\\\\evil.com',
      '/posts\\..\\x',
      '/\t/evil.com',
      '/\n/evil.com',
      'https://evil.com',
      'javascript:alert(1)',
      'posts/1',
      '',
      undefined,
      null,
      42,
    ]) {
      expect(safeUrl(bad)).toBe('/notifications');
    }
  });

  it('every accepted value resolves on the app origin', () => {
    for (const ok of ['/a', '/a/b//c', '/.%2F/evil.com']) {
      expect(new URL(safeUrl(ok), 'https://app.example').origin).toBe('https://app.example');
    }
  });
});
