import { legalTurns, type Side } from '../../shared/rules/index.ts';
import type { Snapshot } from '../../shared/contracts/index.ts';
import type { GameCore } from './lifecycle.ts';

export interface SnapshotConfig {
  model: string;
  jevReady: boolean;
  engine: string;
}

export function toSnapshot(core: GameCore, config: SnapshotConfig, human: Side): Snapshot {
  const humanToMove = core.lifecycle === 'playing' && core.phase === 'human-input' && core.state.sideToMove === human;
  return {
    gameId: core.gameId,
    generation: core.generation,
    version: core.version,
    lifecycle: core.lifecycle,
    phase: core.phase,
    pausedPhase: core.pausedPhase,
    aiStatus: core.aiStatus,
    aiError: core.aiError,
    board: core.state.board.map((p) => (p ? { side: p.side, king: p.king } : null)),
    sideToMove: core.state.sideToMove,
    legalTurns: humanToMove
      ? legalTurns(core.state).map((t) => ({ ...t, landings: [...t.landings], captures: [...t.captures] }))
      : [],
    moves: [...core.moves],
    result: core.result ? { ...core.result } : null,
    quietTurns: { ...core.state.quietTurns },
    config,
  };
}
