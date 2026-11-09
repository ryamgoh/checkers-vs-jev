import { chromium } from '@playwright/test';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror', e.stack?.split('\n').slice(0,8).join(' | ')));
page.on('console', (m) => console.log('console', m.type(), m.text().slice(0, 200)));
await page.goto('http://localhost:3000');
await page.waitForFunction(() => window.__cvj && window.__cvjStore);
const state = () => page.evaluate(() => { const s = window.__cvjStore.getState(); return { v: s.snapshot?.version, life: s.snapshot?.lifecycle, phase: s.snapshot?.phase, ai: s.snapshot?.aiStatus, moves: s.snapshot?.moves.length, shown: s.display?.shownMoves, queue: s.display?.queue.map(m => m.turn.id), live: s.live, busy: s.busy }; });
// count frames
await page.evaluate(() => { window.__frames = 0; const f = () => { window.__frames++; requestAnimationFrame(f); }; requestAnimationFrame(f); });
await page.getByRole('dialog').getByRole('button', { name: 'Start game' }).click();
await page.waitForTimeout(500);
console.log('after start', JSON.stringify(await state()));
await page.evaluate(() => window.__cvjStore.getState().playTurn('11-15'));
for (let i = 0; i < 12; i++) { await page.waitForTimeout(1000); console.log(i, JSON.stringify(await state()), 'frames', await page.evaluate(() => window.__frames)); }
await browser.close();
