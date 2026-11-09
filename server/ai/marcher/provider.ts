import { Worker } from 'node:worker_threads';
import {
  applyLegalTurn,
  distinctTurns,
  gameResult,
  legalTurns,
  type GameState,
} from '../../../shared/rules/index.ts';
import { AbortError, DECISIVE, type EngineProvider, type RankedTurn, type RankedTurns } from '../engine-provider.ts';
import { toMarcher, type MarcherPosition } from './coords.ts';

const WORKER_URL = new URL('./worker.mjs', import.meta.url);
let nextId = 1;

function evaluateInWorker(
  positions: MarcherPosition[],
  seconds: number,
  signal: AbortSignal,
  hardTimeoutMs: number,
): Promise<{ eval: number; depth: number }[]> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new AbortError());
    const worker = new Worker(WORKER_URL);
    const id = nextId++;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      void worker.terminate();
      fn();
    };
    const onAbort = () => finish(() => reject(new AbortError()));
    const timer = setTimeout(() => finish(() => reject(new Error('Engine timed out'))), hardTimeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
    worker.on('message', (msg: { type: string; id: number; results?: { eval: number; depth: number }[]; message?: string }) => {
      if (msg.id !== id) return;
      if (msg.type === 'result') finish(() => resolve(msg.results ?? []));
      else finish(() => reject(new Error(msg.message ?? 'Engine error')));
    });
    worker.on('error', (err) => finish(() => reject(err)));
    worker.postMessage({ type: 'evaluate', id, positions, seconds });
  });
}

/** Scores every distinct legal turn by searching the position after it. */
export class MarcherProvider implements EngineProvider {
  async rankTurns(state: GameState, opts: { budgetMs: number; signal: AbortSignal }): Promise<RankedTurns> {
    const turns = distinctTurns(legalTurns(state));
    const fixed = new Map<string, RankedTurn>();
    const toSearch: { turnId: string; pos: MarcherPosition }[] = [];
    for (const turn of turns) {
      const child = applyLegalTurn(state, turn);
      const result = gameResult(child);
      if (result) {
        // Decided by our own adjudication (including draws the engine cannot see).
        const score = result.winner === null ? 0 : result.winner === state.sideToMove ? DECISIVE : -DECISIVE;
        fixed.set(turn.id, { turnId: turn.id, score, depth: 0 });
      } else {
        toSearch.push({ turnId: turn.id, pos: toMarcher(child.board, child.sideToMove) });
      }
    }

    let searched: RankedTurn[] = [];
    if (toSearch.length > 0) {
      const seconds = Math.max(0.05, opts.budgetMs / 1000 / toSearch.length);
      const results = await evaluateInWorker(
        toSearch.map((t) => t.pos),
        seconds,
        opts.signal,
        opts.budgetMs * 2 + 3000,
      );
      // The child is scored from the opponent's side, so negate it.
      searched = toSearch.map((t, i) => ({ turnId: t.turnId, score: -(results[i]?.eval ?? 0), depth: results[i]?.depth ?? 0 }));
    }

    const candidates = [...fixed.values(), ...searched].sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (!best) throw new Error('No legal turns to rank');
    return { best: best.turnId, candidates, provenance: 'searched' };
  }
}
