import { describe, expect, test } from 'vitest';
import { createEngine, perft } from '../../server/ai/marcher/loader.mjs';
import { toMarcher } from '../../server/ai/marcher/coords.ts';
import { MarcherProvider } from '../../server/ai/marcher/provider.ts';
import { AbortError, DECISIVE } from '../../server/ai/engine-provider.ts';
import {
  applyLegalTurn,
  distinctTurns,
  gameResult,
  initialState,
  legalTurns,
  setupPosition,
  stepPerft,
  type GameState,
} from '../../shared/rules/index.ts';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomPosition(seed: number): GameState | null {
  const rand = rng(seed);
  let s = initialState();
  const plies = Math.floor(rand() * 110);
  for (let i = 0; i < plies; i++) {
    if (gameResult(s)) return null;
    const turns = legalTurns(s);
    s = applyLegalTurn(s, turns[Math.floor(rand() * turns.length)]!);
  }
  return gameResult(s) ? null : s;
}

describe('Marcher matches our rules', () => {
  test('coordinate mapping: starting position perft 1..6', async () => {
    const engine = await createEngine();
    const s = initialState();
    const pos = toMarcher(s.board, s.sideToMove);
    const counts = [1, 2, 3, 4, 5, 6].map((d) => Number(perft(engine, pos, d)));
    expect(counts).toEqual([1, 2, 3, 4, 5, 6].map((d) => stepPerft(s.board, s.sideToMove, d)));
  });

  // Marcher's perft counter lets any capturing piece continue mid-jump; its search does
  // not (USE_FORCED_CONTINUATION). Comparing under its counting convention validates the
  // shared move generator: single steps, mandatory captures, kings and crowning.
  test('step-level perft agrees on 300 random reachable positions, including kings', async () => {
    const engine = await createEngine();
    let compared = 0;
    let withKings = 0;
    let conventionMatters = 0;
    const mismatches: string[] = [];
    for (let seed = 1; compared < 300 && seed < 2000; seed++) {
      const s = randomPosition(seed);
      if (!s) continue;
      compared++;
      if (s.board.some((p) => p?.king)) withKings++;
      const ours = stepPerft(s.board, s.sideToMove, 5, 0, { anyPieceContinues: true });
      const theirs = Number(perft(engine, toMarcher(s.board, s.sideToMove), 5));
      if (ours !== stepPerft(s.board, s.sideToMove, 5)) conventionMatters++;
      if (ours !== theirs) mismatches.push(`seed ${seed}: ours ${ours}, marcher ${theirs}, history ${s.history.join(' ')}`);
    }
    expect(compared).toBe(300);
    expect(withKings).toBeGreaterThan(30);
    expect(conventionMatters).toBeGreaterThan(0);
    expect(mismatches).toEqual([]);
  });
});

describe('MarcherProvider.rankTurns', () => {
  const provider = new MarcherProvider();

  test('scores every distinct legal turn, best first, within budget', async () => {
    const s = initialState();
    const t0 = performance.now();
    const ranked = await provider.rankTurns(s, { budgetMs: 700, signal: new AbortController().signal });
    const elapsed = performance.now() - t0;
    expect(ranked.candidates.map((c) => c.turnId).sort()).toEqual(distinctTurns(legalTurns(s)).map((t) => t.id).sort());
    expect(ranked.candidates[0]?.turnId).toBe(ranked.best);
    const scores = ranked.candidates.map((c) => c.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(ranked.provenance).toBe('searched');
    expect(elapsed).toBeLessThan(700 + 800);
  });

  test('a turn that wins immediately is scored decisive', async () => {
    const ranked = await provider.rankTurns(setupPosition({ red: [14], ivory: [18] }, 'red'), {
      budgetMs: 200,
      signal: new AbortController().signal,
    });
    expect(ranked.best).toBe('14x23');
    expect(ranked.candidates[0]?.score).toBe(DECISIVE);
  });

  test('prefers keeping material over hanging a piece', async () => {
    // Ivory to move. 22-17 is answered by 13x22, losing a man; ivory's other moves are safe.
    const s = setupPosition({ red: [1, 2, 3, 13], ivory: [22, 30, 31, 32] }, 'ivory');
    const ranked = await provider.rankTurns(s, { budgetMs: 600, signal: new AbortController().signal });
    const hang = ranked.candidates.find((c) => c.turnId === '22-17');
    expect(hang).toBeDefined();
    expect(ranked.best).not.toBe('22-17');
    expect(hang!.score).toBeLessThan(ranked.candidates[0]!.score - 50);
  });

  test('abort terminates the search promptly', async () => {
    const controller = new AbortController();
    const t0 = performance.now();
    const p = provider.rankTurns(initialState(), { budgetMs: 5000, signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await expect(p).rejects.toBeInstanceOf(AbortError);
    expect(performance.now() - t0).toBeLessThan(400);
  });
});
