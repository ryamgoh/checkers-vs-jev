import { describe, expect, test, vi } from 'vitest';
import { distinctTurns, initialState, legalTurns, setupPosition } from '../../../shared/rules/index.ts';
import { createOpponent } from '../../../server/ai/opponent.ts';
import { AbortError, type EngineProvider, type RankedTurns } from '../../../server/ai/engine-provider.ts';
import type { JevInput, JevOutcome } from '../../../server/integrations/jev.ts';

const start = initialState();
const ids = distinctTurns(legalTurns(start)).map((t) => t.id);

const ranking: RankedTurns = {
  best: '11-15',
  provenance: 'searched',
  candidates: [
    { turnId: '11-15', score: 10, depth: 14 },
    ...ids.filter((id) => id !== '11-15').map((turnId, i) => ({ turnId, score: -20 - i * 30, depth: 14 })),
  ],
};
const engine = (impl?: EngineProvider['rankTurns']): EngineProvider => ({ rankTurns: vi.fn(impl ?? (async () => ranking)) });
const jevReturning = (...outcomes: JevOutcome[]) => {
  const choose = vi.fn(async (_input: JevInput, _opts: { signal: AbortSignal }) => outcomes.shift() ?? outcomes[0]!);
  return { choose };
};
const opts = () => ({ signal: new AbortController().signal, onStatus: vi.fn() });

describe('opponent: Jev chooses, the engine advises', () => {
  test('Jev receives every distinct legal turn plus the engine ranking', async () => {
    const jev = jevReturning({ kind: 'choice', turnId: '11-15', confidence: 0.95, model: 'm' });
    const o = opts();
    const out = await createOpponent({ engine: engine(), jev, engineBudgetMs: 100, retryDelayMs: 0 })(start, o);
    const input = jev.choose.mock.calls[0]![0];
    expect(input.turns.map((t) => t.id).sort()).toEqual([...ids].sort());
    expect(input.ranking).toBe(ranking);
    expect(o.onStatus.mock.calls.map((c) => c[0])).toEqual(['analyzing', 'choosing']);
    expect(out).toMatchObject({ ok: true, turnId: '11-15', ai: { source: 'jev', provenance: 'searched', matchedEngineBest: true, engineBest: '11-15', score: 10, confidence: 0.95 } });
  });

  test('a legal lower-rated choice is committed as Jev chose it, flagged as a deviation', async () => {
    const jev = jevReturning({ kind: 'choice', turnId: '9-13', confidence: 0.4, model: 'm' });
    const out = await createOpponent({ engine: engine(), jev, engineBudgetMs: 100 })(start, opts());
    expect(out).toMatchObject({ ok: true, turnId: '9-13', ai: { matchedEngineBest: false, engineBest: '11-15' } });
  });

  test('an unknown move id is an error, never a substitute move', async () => {
    const jev = jevReturning({ kind: 'choice', turnId: '1-5', confidence: 1, model: 'm' });
    const out = await createOpponent({ engine: engine(), jev, engineBudgetMs: 100 })(start, opts());
    expect(out).toEqual({ ok: false, error: 'Jev returned an unknown move (1-5).' });
  });

  test('a retryable failure is retried once, then reported without moving', async () => {
    const err: JevOutcome = { kind: 'error', retryable: true, message: 'Jev timed out.' };
    const jev = jevReturning(err, err);
    const out = await createOpponent({ engine: engine(), jev, engineBudgetMs: 100, retryDelayMs: 0 })(start, opts());
    expect(jev.choose).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ ok: false, error: 'Jev unavailable: Jev timed out.' });
  });

  test('a transient failure followed by a choice succeeds', async () => {
    const jev = jevReturning({ kind: 'error', retryable: true, message: 'x' }, { kind: 'choice', turnId: '10-15', confidence: 0.8, model: 'm' });
    const out = await createOpponent({ engine: engine(), jev, engineBudgetMs: 100, retryDelayMs: 0 })(start, opts());
    expect(out).toMatchObject({ ok: true, turnId: '10-15' });
  });

  test('a non-retryable failure (bad key) is not retried', async () => {
    const jev = jevReturning({ kind: 'error', retryable: false, status: 401, message: 'OpenRouter rejected the API key.' });
    const out = await createOpponent({ engine: engine(), jev, engineBudgetMs: 100 })(start, opts());
    expect(jev.choose).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ ok: false });
  });

  test('a refusal is reported without moving', async () => {
    const out = await createOpponent({ engine: engine(), jev: jevReturning({ kind: 'refusal' }), engineBudgetMs: 100 })(start, opts());
    expect(out).toEqual({ ok: false, error: 'Jev declined to choose a move.' });
  });

  test('if the engine fails, Jev still chooses from unannotated moves', async () => {
    const jev = jevReturning({ kind: 'choice', turnId: '12-16', confidence: 0.3, model: 'm' });
    const failing = engine(async () => {
      throw new Error('worker crashed');
    });
    const out = await createOpponent({ engine: failing, jev, engineBudgetMs: 100 })(start, opts());
    expect(jev.choose.mock.calls[0]![0].ranking).toBeNull();
    expect(out).toMatchObject({ ok: true, turnId: '12-16', ai: { provenance: 'unanalyzed', matchedEngineBest: null } });
  });

  test('a single legal move is played as forced without calling Jev or the engine', async () => {
    const jev = jevReturning({ kind: 'refusal' });
    const eng = engine();
    const out = await createOpponent({ engine: eng, jev, engineBudgetMs: 100, minThinkMs: 0 })(
      setupPosition({ red: [14], ivory: [18, 32] }, 'ivory'),
      opts(),
    );
    expect(jev.choose).not.toHaveBeenCalled();
    expect(eng.rankTurns).not.toHaveBeenCalled();
    expect(out).toMatchObject({ ok: true, turnId: '18x9', ai: { source: 'forced' } });
  });

  test('abort during analysis rejects with AbortError and never calls Jev', async () => {
    const controller = new AbortController();
    const slow = engine(
      (_s, { signal }) => new Promise<RankedTurns>((_, reject) => signal.addEventListener('abort', () => reject(new AbortError()))),
    );
    const jev = jevReturning({ kind: 'choice', turnId: '11-15', confidence: 1, model: 'm' });
    const p = createOpponent({ engine: slow, jev, engineBudgetMs: 100 })(start, { signal: controller.signal, onStatus: vi.fn() });
    controller.abort();
    await expect(p).rejects.toBeInstanceOf(AbortError);
    expect(jev.choose).not.toHaveBeenCalled();
  });
});
