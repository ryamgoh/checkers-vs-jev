// Visual review: drives the real WebGL board via the projection test hook and saves screenshots.
// Usage: node scripts/screenshots.mjs [baseUrl] [outDir]
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:3000';
const out = process.argv[3] ?? '/tmp/cvj-shots';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];

async function clickSquare(page, sq) {
  const p = await page.evaluate((s) => window.__cvj.squareToScreen(s), sq);
  await page.mouse.click(p.x, p.y);
}
const status = (page) => page.getByTestId('status').innerText();
async function waitStatus(page, re, timeout = 30000) {
  await page.waitForFunction((src) => new RegExp(src).test(document.querySelector('[data-testid=status]')?.textContent ?? ''), re.source, { timeout });
}

for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name} console: ${m.text()}`));
  await page.goto(base);
  await page.waitForFunction(() => window.__cvj && document.querySelector('canvas'));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${name}-1-ready.png` });
  if (name === 'mobile') {
    await page.close();
    continue;
  }
  await page.getByRole('dialog').getByRole('button', { name: 'Start game' }).click();
  await waitStatus(page, /Your turn/);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}-2-start.png` });
  await clickSquare(page, 11);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${name}-3-selected.png` });
  await clickSquare(page, 15);
  await waitStatus(page, /Jev/);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}-4-thinking.png` });
  await waitStatus(page, /Your turn/, 30000);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}-5-replied.png` });
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}-6-paused.png` });
  console.log('final status:', await status(page));
  await page.close();
}
await browser.close();
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
