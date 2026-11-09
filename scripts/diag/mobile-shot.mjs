import { chromium } from '@playwright/test';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await page.goto(process.argv[2] ?? 'http://localhost:3000');
await page.waitForFunction(() => window.__cvj && window.__cvjStore?.getState().snapshot);
await page.getByRole('dialog').getByRole('button', { name: 'Start game' }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: '/tmp/cvj-shots/mobile-2-playing.png' });
await browser.close();
