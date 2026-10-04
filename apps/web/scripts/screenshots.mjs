#!/usr/bin/env node
// Visual QA: screenshots of / and /design at phone and desktop sizes, light and dark.
// Usage: node scripts/screenshots.mjs <outDir> [baseUrl]   (server must be running)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'screenshots';
const baseUrl = process.argv[3] ?? 'http://localhost:3000';
const executablePath = process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const viewports = { mobile: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } };
const pages = { landing: '/', design: '/design' };
const locale = process.env.LOCALE ?? 'ru';

for (const [vpName, viewport] of Object.entries(viewports)) {
  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: 1 });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: baseUrl }]);
    const page = await context.newPage();
    for (const [name, path] of Object.entries(pages)) {
      await page.goto(baseUrl + path, { waitUntil: 'load' });
      await page.waitForTimeout(1200);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const file = join(outDir, `${name}-${vpName}-${scheme}-${locale}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`${file}  horizontalOverflow=${overflow}`);
    }
    await context.close();
  }
}
await browser.close();
