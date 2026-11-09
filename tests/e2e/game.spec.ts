import { expect, test, type Page } from '@playwright/test';

const FAKE = 'http://localhost:4100';
const control = (page: Page, body: object) => page.request.post(`${FAKE}/control`, { data: body });
const jevCalls = async (page: Page) => ((await (await page.request.get(`${FAKE}/calls`)).json()) as { calls: number }).calls;

const status = (page: Page) => page.getByTestId('status');
const historyMoves = (page: Page) => page.locator('.history .mv').filter({ hasText: /\d/ });

async function open(page: Page) {
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { __cvj?: object }).__cvj);
}
async function start(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Start game' }).click();
  await expect(status(page)).toHaveText(/Your turn/);
}
async function clickSquare(page: Page, sq: number) {
  const p = await page.evaluate((s) => (window as unknown as { __cvj: { squareToScreen(n: number): { x: number; y: number } } }).__cvj.squareToScreen(s), sq);
  await page.mouse.click(p.x, p.y);
}
/** Waits until the AI has replied and its animation finished. */
async function waitForHumanTurn(page: Page, plies: number) {
  await expect(historyMoves(page)).toHaveCount(plies, { timeout: 20_000 });
  await expect(status(page)).toHaveText(/Your turn/, { timeout: 20_000 });
}

test.beforeEach(async ({ page }) => {
  await control(page, { delayMs: 0, failNext: 0, reset: true });
});

test('ready screen: board visible, no AI work until Start', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('dialog', { name: 'Checkers vs Jev' })).toBeVisible();
  await expect(status(page)).toHaveText('Press Start to begin');
  await page.waitForTimeout(500);
  expect(await jevCalls(page)).toBe(0);
  await start(page);
  expect(await jevCalls(page)).toBe(0); // you move first
});

test('play on the 3D board: select, move, Jev replies', async ({ page }) => {
  await open(page);
  await start(page);
  await clickSquare(page, 11);
  await clickSquare(page, 15);
  await waitForHumanTurn(page, 2);
  await expect(page.locator('.history li').first()).toContainText('11-15');
  await expect(page.locator('.tag').first()).toHaveText('engine best');
  expect(await jevCalls(page)).toBe(1);
});

test('illegal clicks explain themselves and do not move', async ({ page }) => {
  await open(page);
  await start(page);
  await clickSquare(page, 1);
  await expect(page.locator('.message')).toHaveText('That piece has no legal moves.');
  await clickSquare(page, 11);
  await clickSquare(page, 18);
  await expect(page.locator('.message')).toHaveText('That is not a legal destination.');
  await expect(historyMoves(page)).toHaveCount(0);
});

test('keyboard: the legal-move list plays a move', async ({ page }) => {
  await open(page);
  await start(page);
  const button = page.getByRole('region', { name: 'Your legal moves' }).getByRole('button', { name: '10-14' });
  await button.focus();
  await page.keyboard.press('Enter');
  await waitForHumanTurn(page, 2);
  await expect(page.locator('.history li').first()).toContainText('10-14');
});

test('pause while Jev is thinking freezes the game; resume completes the turn', async ({ page }) => {
  await open(page);
  await start(page);
  await control(page, { delayMs: 5000 }); // long enough that Pause always lands mid-decision
  await clickSquare(page, 11);
  await clickSquare(page, 15);
  await expect(status(page)).toHaveText(/Jev/);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('dialog', { name: 'Game paused' })).toBeVisible();
  await page.waitForTimeout(6000); // past the moment the cancelled answer would have arrived
  await expect(historyMoves(page)).toHaveCount(1); // the cancelled AI result never landed
  await control(page, { delayMs: 0 });
  await page.getByRole('dialog').getByRole('button', { name: 'Resume' }).click();
  await waitForHumanTurn(page, 2);
});

test('restart asks for confirmation; cancel keeps the game, confirm resets it', async ({ page }) => {
  await open(page);
  await start(page);
  await clickSquare(page, 11);
  await clickSquare(page, 15);
  await waitForHumanTurn(page, 2);
  await page.getByRole('button', { name: 'Restart' }).click();
  await page.getByRole('dialog', { name: 'Restart this game?' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(historyMoves(page)).toHaveCount(2);
  await page.getByRole('button', { name: 'Restart' }).click();
  await page.getByRole('dialog', { name: 'Restart this game?' }).getByRole('button', { name: 'Restart' }).click();
  await expect(page.locator('.history')).toHaveCount(0);
  await expect(status(page)).toHaveText('Your turn');
});

test('Jev failure shows an error without moving; Retry recovers', async ({ page }) => {
  await open(page);
  await start(page);
  await control(page, { failNext: 2 }); // first attempt and its one retry both fail
  await clickSquare(page, 11);
  await clickSquare(page, 15);
  await expect(status(page)).toHaveText('Jev unavailable', { timeout: 15_000 });
  await expect(page.locator('.error-detail')).toContainText('OpenRouter returned HTTP 503');
  await expect(historyMoves(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Retry' }).click();
  await waitForHumanTurn(page, 2);
});

test('a refresh restores the same game', async ({ page }) => {
  await open(page);
  await start(page);
  await clickSquare(page, 11);
  await clickSquare(page, 15);
  await waitForHumanTurn(page, 2);
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __cvj?: object }).__cvj);
  await expect(historyMoves(page)).toHaveCount(2);
  await expect(status(page)).toHaveText(/Your turn/);
});

test('a full game reaches a result; Play again starts fresh', async ({ page }) => {
  test.setTimeout(300_000);
  await page.emulateMedia({ reducedMotion: 'reduce' }); // instant moves; also covers the reduced-motion path
  await open(page);
  await start(page);
  const playAgain = page.getByRole('dialog').getByRole('button', { name: 'Play again' });
  const deadline = Date.now() + 270_000;
  while (Date.now() < deadline && !(await playAgain.isVisible())) {
    const moves = page.getByRole('region', { name: 'Your legal moves' }).getByRole('button');
    if ((await moves.count()) > 0 && /Your turn/.test(await status(page).innerText())) {
      await moves.last().click();
    }
    await page.waitForTimeout(250);
  }
  await expect(playAgain).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText(/You win|Jev wins|Draw/);
  await playAgain.click();
  await expect(status(page)).toHaveText('Your turn');
  await expect(page.locator('.history')).toHaveCount(0);
});
