#!/usr/bin/env node
// Computes WCAG 2.x contrast ratios for every token pair the UI relies on,
// reading the actual values from src/app/globals.css (:root and .dark).
// Usage: node scripts/check-contrast.mjs [--markdown]   (exit code 1 on failure)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../src/app/globals.css'), 'utf8');

function block(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No ${selector} block`);
  const end = css.indexOf('\n}', start);
  const vars = {};
  for (const m of css.slice(start, end).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) vars[m[1]] = m[2];
  return vars;
}

const light = { ...block(':root'), white: '#ffffff' };
// .dark only overrides; tokens it doesn't redefine (avatar palette) inherit from :root.
const themes = { light, dark: { ...light, ...block('.dark') } };

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// [foreground, background, minimum, usage]
const TEXT = 4.5;
const UI = 3; // WCAG 1.4.11 non-text contrast (input borders, focus ring, icons, large SOS button)
const pairs = [
  ['foreground', 'background', TEXT, 'Body text'],
  ['card-foreground', 'card', TEXT, 'Text on cards'],
  ['popover-foreground', 'popover', TEXT, 'Menus, popovers'],
  ['muted-foreground', 'background', TEXT, 'Secondary text'],
  ['muted-foreground', 'card', TEXT, 'Secondary text on cards'],
  ['muted-foreground', 'muted', TEXT, 'Secondary text on muted'],
  ['accent-foreground', 'accent', TEXT, 'Hovered menu item'],
  ['primary-foreground', 'primary', TEXT, 'Primary button'],
  ['primary-foreground', 'primary-hover', TEXT, 'Primary button hover'],
  ['primary', 'background', TEXT, 'Links on page'],
  ['primary', 'card', TEXT, 'Links on cards'],
  ['primary-soft-foreground', 'primary-soft', TEXT, 'Selected / info badge'],
  ['secondary-foreground', 'secondary', TEXT, 'Secondary button'],
  ['secondary-foreground', 'secondary-hover', TEXT, 'Secondary button hover'],
  ['sos-foreground', 'sos', TEXT, 'SOS button'],
  ['sos-foreground', 'sos-hover', TEXT, 'SOS button hover'],
  ['sos-soft-foreground', 'sos-soft', TEXT, 'SOS alert banner'],
  ['sos-soft-foreground', 'card', TEXT, 'SOS-coloured text on cards'],
  ['sos-soft-foreground', 'background', TEXT, 'SOS-coloured text on page'],
  ['danger-foreground', 'danger', TEXT, 'Danger button'],
  ['danger-foreground', 'danger-hover', TEXT, 'Danger button hover'],
  ['danger', 'card', TEXT, 'Error text on cards'],
  ['danger', 'background', TEXT, 'Error text on page'],
  ['danger-soft-foreground', 'danger-soft', TEXT, 'Error banner'],
  ['success-foreground', 'success', TEXT, 'Success solid'],
  ['success', 'card', TEXT, 'Success text'],
  ['success-soft-foreground', 'success-soft', TEXT, 'Success badge'],
  ['warning-foreground', 'warning', TEXT, 'Warning solid'],
  ['warning', 'card', TEXT, 'Warning text'],
  ['warning-soft-foreground', 'warning-soft', TEXT, 'Warning badge'],
  ['tier-bronze-foreground', 'tier-bronze-soft', TEXT, 'Tier bronze badge'],
  ['tier-bronze', 'card', UI, 'Tier bronze avatar ring'],
  ['tier-silver-foreground', 'tier-silver-soft', TEXT, 'Tier silver badge'],
  ['tier-silver', 'card', UI, 'Tier silver avatar ring'],
  ['tier-gold-foreground', 'tier-gold-soft', TEXT, 'Tier gold badge'],
  ['tier-gold', 'card', UI, 'Tier gold avatar ring'],
  ['tier-platinum-foreground', 'tier-platinum-soft', TEXT, 'Tier platinum badge'],
  ['tier-platinum', 'card', UI, 'Tier platinum avatar ring'],
  ['premium-soft-foreground', 'premium-soft', TEXT, 'Premium badge'],
  ['premium-foreground', 'premium', TEXT, 'Premium solid'],
  ['premium', 'card', UI, 'Premium frame'],
  ['trust-low', 'card', TEXT, 'Trust low text'],
  ['trust-low-foreground', 'trust-low-soft', TEXT, 'Trust low badge'],
  ['trust-medium', 'card', TEXT, 'Trust medium text'],
  ['trust-medium-foreground', 'trust-medium-soft', TEXT, 'Trust medium badge'],
  ['trust-high', 'card', TEXT, 'Trust high text'],
  ['trust-high-foreground', 'trust-high-soft', TEXT, 'Trust high badge'],
  ['input', 'card', UI, 'Input border on card'],
  ['input', 'background', UI, 'Input border on page'],
  ['ring', 'background', UI, 'Focus ring on page'],
  ['ring', 'card', UI, 'Focus ring on card'],
  ['sos', 'background', UI, 'SOS button vs page'],
  ['primary', 'muted', UI, 'Active nav icon on muted'],
  ...Array.from({ length: 8 }, (_, i) => ['white', `avatar-${i + 1}`, TEXT, 'Avatar initials']),
];

const markdown = process.argv.includes('--markdown');
let failures = 0;
const rows = [];

for (const [fg, bg, min, usage] of pairs) {
  const cells = [];
  for (const [name, vars] of Object.entries(themes)) {
    const a = vars[fg];
    const b = vars[bg];
    if (!a || !b) throw new Error(`Missing --${!a ? fg : bg} in ${name}`);
    const r = ratio(a, b);
    const ok = r >= min;
    if (!ok) failures += 1;
    cells.push({ name, r, ok, a, b });
  }
  rows.push({ fg, bg, min, usage, cells });
}

if (markdown) {
  console.log('| Foreground | Background | Usage | Min | Light | Dark |');
  console.log('|---|---|---|---|---|---|');
  for (const { fg, bg, min, usage, cells } of rows) {
    const fmt = (c) => `${c.r.toFixed(2)} ${c.ok ? '✅' : '❌'}`;
    console.log(`| \`${fg}\` | \`${bg}\` | ${usage} | ${min} | ${fmt(cells[0])} | ${fmt(cells[1])} |`);
  }
} else {
  for (const { fg, bg, min, cells } of rows) {
    const line = cells.map((c) => `${c.name} ${c.r.toFixed(2)}${c.ok ? '' : ' FAIL'}`).join('  ');
    console.log(`${`${fg} / ${bg}`.padEnd(50)} ≥${min}  ${line}`);
  }
}

console.error(`\n${rows.length * 2} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
