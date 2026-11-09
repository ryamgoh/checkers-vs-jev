import type { GameState } from '../../shared/rules/index.ts';

export interface RankedTurn {
  readonly turnId: string;
  /** Engine score from the moving side's point of view (about 120 per man; |score| ≥ 2000 is a forced result). */
  readonly score: number;
  readonly depth: number;
}

export interface RankedTurns {
  /** Every distinct legal turn, best first; candidates[0].turnId === best. */
  readonly best: string;
  readonly candidates: readonly RankedTurn[];
  readonly provenance: 'searched' | 'exact';
}

export interface EngineProvider {
  rankTurns(state: GameState, opts: { budgetMs: number; signal: AbortSignal }): Promise<RankedTurns>;
}

/** Score for a turn that ends the game immediately. */
export const DECISIVE = 4000;
export const FORCED_RESULT = 2000;

export class AbortError extends Error {
  constructor() {
    super('Aborted');
    this.name = 'AbortError';
  }
}
