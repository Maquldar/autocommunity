#!/usr/bin/env node
// Generates the PWA / favicon set from the SVG logo mark (same geometry as src/components/shell/logo.tsx).
// Usage: node scripts/generate-icons.mjs   — writes into public/ (commit the results).
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '../public');
const iconsDir = join(publicDir, 'icons');

// sharp is a dependency of next (image optimisation) and lives in the pnpm store;
// resolve it through next so we don't add a direct dependency just for this script.
const require = createRequire(import.meta.url);
const sharp = require(require.resolve('sharp', { paths: [dirname(require.resolve('next/package.json'))] }));

const BRAND = '#1f5ae0';

/** The mark drawn on a 512 canvas. `scale` shrinks the pin for maskable safe zones. */
function glyph(scale = 1) {
  const t = `translate(256 256) scale(${scale}) translate(-256 -256)`;
  return `
  <g transform="${t}">
    <path d="M256 430c-8 0-14-4-19-10-46-55-109-124-109-196a128 128 0 0 1 256 0c0 72-63 141-109 196-5 6-11 10-19 10z" fill="#fff"/>
    <circle cx="256" cy="222" r="76" fill="none" stroke="${BRAND}" stroke-width="24"/>
    <path d="M182 232h148M256 232v64" fill="none" stroke="${BRAND}" stroke-width="22"/>
    <circle cx="256" cy="232" r="27" fill="${BRAND}"/>
  </g>`;
}

const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="120" fill="${BRAND}"/>${glyph()}
</svg>`;

// Full-bleed square; the OS applies its own mask. Glyph kept inside the 80% safe circle.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BRAND}"/>${glyph(0.78)}
</svg>`;

// iOS adds its own rounded corners and ignores transparency, so apple-touch-icon is full-bleed too.
const apple = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BRAND}"/>${glyph(0.86)}
</svg>`;

async function png(svg, size) {
  return sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

/** Minimal ICO container with embedded PNGs (supported by every current browser). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

mkdirSync(iconsDir, { recursive: true });

const outputs = [
  ['icons/icon-192.png', rounded, 192],
  ['icons/icon-512.png', rounded, 512],
  ['icons/icon-maskable-512.png', maskable, 512],
  ['icons/apple-touch-icon.png', apple, 180],
  ['icons/favicon-32.png', rounded, 32],
];

for (const [file, svg, size] of outputs) {
  writeFileSync(join(publicDir, file), await png(svg, size));
  console.log(`wrote public/${file}`);
}

writeFileSync(join(iconsDir, 'icon.svg'), rounded);
console.log('wrote public/icons/icon.svg');

const favicon = ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(rounded, size) }))));
writeFileSync(join(publicDir, 'favicon.ico'), favicon);
console.log('wrote public/favicon.ico');
