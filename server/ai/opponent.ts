import { distinctTurns, legalTurns, type GameState } from '../../shared/rules/index.ts';
import type { AiMove, AiStatus } from '../../shared/contracts/index.ts';
import type { AiOutcome } from '../game/lifecycle.ts';
import type { AiRunner } from '../game/store.ts';
import type { JevInput, JevOutcome } from '../integrations/jev.ts';
import { AbortError, type EngineProvider, type RankedTurns } from './engine-provider.ts';

export interface OpponentDeps {
  engine: EngineProvider | null;
  jev: { choose(input: JevInput, opts: { signal: AbortSignal }): Promise<JevOutcome> };
  engineBudgetMs: number;
  /** Minimum visible thinking time for a forced move. */
  minThinkMs?: number;
  retryDelayMs?: number;
  now?: () => number;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new AbortError());
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Jev is the opponent's engine: it chooses every move from all legal turns.
 * Marcher only annotates each turn with an evaluation and never overrides Jev.
 * If Jev cannot choose, the AI does not move (no silent substitute).
 */
export function createOpponent(deps: OpponentDeps): AiRunner {
  const now = deps.now ?? (() => performance.now());
  return async (state: GameState, { signal, onStatus }: { signal: AbortSignal; onStatus: (s: AiStatus) => void }) => {
    const started = now();
    const turns = distinctTurns(legalTurns(state));
    const only = turns[0];
    if (!only) return { ok: false, error: 'No legal moves for the AI.' };

    if (turns.length === 1) {
      await sleep(deps.minThinkMs ?? 450, signal);
      const forced: AiMove = {
        turnId: only.id,
        source: 'forced',
        provenance: 'searched',
        matchedEngineBest: null,
        engineBest: only.id,
        score: null,
        depth: null,
        confidence: null,
        model: null,
        ms: Math.round(now() - started),
      };
      return { ok: true, turnId: only.id, ai: forced };
    }

    onStatus('analyzing');
    let ranking: RankedTurns | null = null;
    if (deps.engine) {
      try {
        ranking = await deps.engine.rankTurns(state, { budgetMs: deps.engineBudgetMs, signal });
      } catch (err) {
        if (signal.aborted || err instanceof AbortError) throw new AbortError();
        ranking = null; // Jev still chooses, from unannotated moves
      }
    }
    if (signal.aborted) throw new AbortError();

    onStatus('choosing');
    const input: JevInput = { state, turns, ranking };
    let outcome = await deps.jev.choose(input, { signal });
    if (outcome.kind === 'error' && outcome.retryable && !signal.aborted) {
      await sleep(deps.retryDelayMs ?? 300, signal);
      outcome = await deps.jev.choose(input, { signal });
    }
    if (signal.aborted) throw new AbortError();

    if (outcome.kind === 'refusal') return { ok: false, error: 'Jev declined to choose a move.' } satisfies AiOutcome;
    if (outcome.kind === 'error') return { ok: false, error: `Jev unavailable: ${outcome.message}` } satisfies AiOutcome;
    const chosen = turns.find((t) => t.id === outcome.turnId);
    if (!chosen) return { ok: false, error: `Jev returned an unknown move (${outcome.turnId}).` } satisfies AiOutcome;

    const scored = ranking?.candidates.find((c) => c.turnId === chosen.id) ?? null;
    const bestScore = ranking?.candidates[0]?.score ?? null;
    const ai: AiMove = {
      turnId: chosen.id,
      source: 'jev',
      provenance: ranking ? ranking.provenance : 'unanalyzed',
      matchedEngineBest: ranking && scored && bestScore !== null ? scored.score >= bestScore : null,
      engineBest: ranking?.best ?? null,
      score: scored?.score ?? null,
      depth: scored?.depth ?? null,
      confidence: outcome.confidence,
      model: outcome.model,
      ms: Math.round(now() - started),
    };
    return { ok: true, turnId: chosen.id, ai };
  };
}
