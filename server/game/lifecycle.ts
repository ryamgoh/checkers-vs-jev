import {
  applyLegalTurn,
  gameResult,
  initialState,
  legalTurns,
  type GameResult,
  type GameState,
} from '../../shared/rules/index.ts';
import type { AiMove, AiStatus, Command, CommandError, Lifecycle, MoveRecord, Phase } from '../../shared/contracts/index.ts';

export const HUMAN = 'red' as const;
export const AI = 'ivory' as const;

export interface GameCore {
  readonly gameId: string;
  readonly generation: number;
  readonly version: number;
  readonly lifecycle: Lifecycle;
  readonly phase: Phase | null;
  readonly pausedPhase: Phase | null;
  readonly state: GameState;
  readonly result: GameResult | null;
  readonly moves: readonly MoveRecord[];
  readonly aiStatus: AiStatus;
  readonly aiError: string | null;
  /** The one AI job allowed to commit; anything else is stale. */
  readonly aiJobId: string | null;
}

export type Effect = { type: 'start-ai'; jobId: string } | { type: 'cancel-ai' };

export type Reduction =
  | { ok: true; core: GameCore; effects: Effect[] }
  | { ok: false; error: CommandError; message: string };

export type AiOutcome = { ok: true; turnId: string; ai: AiMove } | { ok: false; error: string };

export function newGame(gameId: string): GameCore {
  return {
    gameId,
    generation: 1,
    version: 0,
    lifecycle: 'ready',
    phase: null,
    pausedPhase: null,
    state: initialState(),
    result: null,
    moves: [],
    aiStatus: 'idle',
    aiError: null,
    aiJobId: null,
  };
}

const fail = (error: CommandError, message: string): Reduction => ({ ok: false, error, message });
const bump = (core: GameCore, patch: Partial<GameCore>): GameCore => ({ ...core, ...patch, version: core.version + 1 });

/** After a committed turn: finish, hand the turn to the AI, or back to the human. */
function afterTurn(core: GameCore, state: GameState, record: MoveRecord, newJobId: () => string): Reduction {
  const moves = [...core.moves, record];
  const result = gameResult(state);
  const base = { state, moves, aiStatus: 'idle' as const, aiError: null, pausedPhase: null };
  if (result) {
    return { ok: true, core: bump(core, { ...base, lifecycle: 'finished', phase: null, result, aiJobId: null }), effects: [] };
  }
  if (state.sideToMove === AI) {
    const jobId = newJobId();
    return {
      ok: true,
      core: bump(core, { ...base, phase: 'ai-thinking', aiJobId: jobId }),
      effects: [{ type: 'start-ai', jobId }],
    };
  }
  return { ok: true, core: bump(core, { ...base, phase: 'human-input', aiJobId: null }), effects: [] };
}

export function reduceCommand(core: GameCore, command: Command, newJobId: () => string): Reduction {
  switch (command.type) {
    case 'start':
      if (core.lifecycle !== 'ready') return fail('not-ready', 'The game has already started.');
      return { ok: true, core: bump(core, { lifecycle: 'playing', phase: 'human-input' }), effects: [] };

    case 'move': {
      if (core.lifecycle !== 'playing' || core.phase !== 'human-input' || core.state.sideToMove !== HUMAN) {
        return fail('not-your-turn', 'It is not your turn.');
      }
      const turn = legalTurns(core.state).find((t) => t.id === command.turnId);
      if (!turn) return fail('illegal-move', `${command.turnId} is not a legal move here.`);
      const record: MoveRecord = { ply: core.state.ply + 1, side: HUMAN, turn: { ...turn, landings: [...turn.landings], captures: [...turn.captures] }, ai: null };
      return afterTurn(core, applyLegalTurn(core.state, turn), record, newJobId);
    }

    case 'pause':
      if (core.lifecycle !== 'playing') return fail('not-playing', 'Only a game in progress can be paused.');
      return {
        ok: true,
        core: bump(core, { lifecycle: 'paused', pausedPhase: core.phase, phase: null, aiStatus: 'idle', aiJobId: null }),
        effects: core.aiJobId ? [{ type: 'cancel-ai' }] : [],
      };

    case 'resume': {
      if (core.lifecycle !== 'paused') return fail('not-paused', 'The game is not paused.');
      const phase = core.pausedPhase ?? 'human-input';
      if (phase === 'ai-thinking') {
        const jobId = newJobId();
        return {
          ok: true,
          core: bump(core, { lifecycle: 'playing', phase, pausedPhase: null, aiJobId: jobId }),
          effects: [{ type: 'start-ai', jobId }],
        };
      }
      return { ok: true, core: bump(core, { lifecycle: 'playing', phase, pausedPhase: null }), effects: [] };
    }

    case 'restart': {
      const fresh = newGame(core.gameId);
      return {
        ok: true,
        core: { ...fresh, generation: core.generation + 1, version: core.version + 1, lifecycle: 'playing', phase: 'human-input' },
        effects: core.aiJobId ? [{ type: 'cancel-ai' }] : [],
      };
    }

    case 'retry-ai': {
      if (core.lifecycle !== 'playing' || core.phase !== 'ai-error') return fail('no-ai-error', 'There is no failed AI turn to retry.');
      const jobId = newJobId();
      return {
        ok: true,
        core: bump(core, { phase: 'ai-thinking', aiError: null, aiJobId: jobId }),
        effects: [{ type: 'start-ai', jobId }],
      };
    }
  }
}

const ownsTurn = (core: GameCore, jobId: string) =>
  core.aiJobId === jobId && core.lifecycle === 'playing' && core.phase === 'ai-thinking' && core.state.sideToMove === AI;

/** Commits an AI result only if it belongs to the current job; otherwise returns null (stale). */
export function reduceAiOutcome(core: GameCore, jobId: string, outcome: AiOutcome): GameCore | null {
  if (!ownsTurn(core, jobId)) return null;
  if (!outcome.ok) {
    return bump(core, { phase: 'ai-error', aiError: outcome.error, aiStatus: 'idle', aiJobId: null });
  }
  const turn = legalTurns(core.state).find((t) => t.id === outcome.turnId);
  if (!turn) {
    return bump(core, { phase: 'ai-error', aiError: `AI chose an illegal move (${outcome.turnId}).`, aiStatus: 'idle', aiJobId: null });
  }
  const record: MoveRecord = {
    ply: core.state.ply + 1,
    side: AI,
    turn: { ...turn, landings: [...turn.landings], captures: [...turn.captures] },
    ai: outcome.ai,
  };
  const reduced = afterTurn(core, applyLegalTurn(core.state, turn), record, () => {
    throw new Error('The AI cannot move twice in a row');
  });
  return reduced.ok ? reduced.core : null;
}

/** Progress updates for the current job; they do not change the logical version. */
export function reduceAiStatus(core: GameCore, jobId: string, status: AiStatus): GameCore | null {
  if (!ownsTurn(core, jobId) || core.aiStatus === status) return null;
  return { ...core, aiStatus: status };
}
