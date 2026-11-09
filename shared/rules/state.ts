import { applyToBoard, generateTurns } from './movegen.ts';
import { IllegalTurnError, other } from './types.ts';
import type { Board, GameResult, GameState, Piece, Side, Square, Turn } from './types.ts';

export function positionKey(board: Board, sideToMove: Side): string {
  let key = '';
  for (const p of board) key += p ? (p.side === 'red' ? (p.king ? 'R' : 'r') : p.king ? 'I' : 'i') : '.';
  return `${key}:${sideToMove === 'red' ? 'r' : 'i'}`;
}

function freshState(board: Board, sideToMove: Side): GameState {
  return {
    board,
    sideToMove,
    ply: 0,
    history: [],
    positionCounts: { [positionKey(board, sideToMove)]: 1 },
    quietTurns: { red: 0, ivory: 0 },
  };
}

export function initialState(): GameState {
  const board: (Piece | null)[] = Array.from({ length: 32 }, () => null);
  for (let sq = 1; sq <= 12; sq++) board[sq - 1] = { side: 'red', king: false };
  for (let sq = 21; sq <= 32; sq++) board[sq - 1] = { side: 'ivory', king: false };
  return freshState(board, 'red');
}

export interface PositionSpec {
  red?: Square[];
  redKings?: Square[];
  ivory?: Square[];
  ivoryKings?: Square[];
}

/** Builds an arbitrary position (for tests, fixtures and seeded games). */
export function setupPosition(spec: PositionSpec, sideToMove: Side): GameState {
  const board: (Piece | null)[] = Array.from({ length: 32 }, () => null);
  const place = (squares: Square[] | undefined, side: Side, king: boolean) => {
    for (const sq of squares ?? []) {
      if (sq < 1 || sq > 32 || board[sq - 1]) throw new Error(`Bad or duplicate square ${sq}`);
      board[sq - 1] = { side, king };
    }
  };
  place(spec.red, 'red', false);
  place(spec.redKings, 'red', true);
  place(spec.ivory, 'ivory', false);
  place(spec.ivoryKings, 'ivory', true);
  return freshState(board, sideToMove);
}

export function legalTurns(state: GameState): Turn[] {
  return generateTurns(state.board, state.sideToMove);
}

/** Applies a turn already known to be legal. */
export function applyLegalTurn(state: GameState, turn: Turn): GameState {
  const piece = state.board[turn.from - 1] as Piece;
  const board = applyToBoard(state.board, turn);
  const sideToMove = other(state.sideToMove);
  const key = positionKey(board, sideToMove);
  // A capture or a man move is irreversible: it resets both quiet counters,
  // and no earlier position can recur, so repetition history restarts.
  const irreversible = turn.captures.length > 0 || !piece.king;
  return {
    board,
    sideToMove,
    ply: state.ply + 1,
    history: [...state.history, turn.id],
    positionCounts: irreversible ? { [key]: 1 } : { ...state.positionCounts, [key]: (state.positionCounts[key] ?? 0) + 1 },
    quietTurns: irreversible
      ? { red: 0, ivory: 0 }
      : { ...state.quietTurns, [state.sideToMove]: state.quietTurns[state.sideToMove] + 1 },
  };
}

export function applyTurn(state: GameState, turnId: string): GameState {
  const turn = legalTurns(state).find((t) => t.id === turnId);
  if (!turn) throw new IllegalTurnError(turnId);
  return applyLegalTurn(state, turn);
}

/** Result at a turn boundary, or null while the game continues. No-moves is checked before draws. */
export function gameResult(state: GameState): GameResult | null {
  if (legalTurns(state).length === 0) return { winner: other(state.sideToMove), reason: 'no-moves' };
  if ((state.positionCounts[positionKey(state.board, state.sideToMove)] ?? 0) >= 3) {
    return { winner: null, reason: 'repetition' };
  }
  if (state.quietTurns.red >= 40 && state.quietTurns.ivory >= 40) return { winner: null, reason: 'forty-move' };
  return null;
}

export function pieceCounts(board: Board): Record<Side, { men: number; kings: number }> {
  const counts = { red: { men: 0, kings: 0 }, ivory: { men: 0, kings: 0 } };
  for (const p of board) if (p) counts[p.side][p.king ? 'kings' : 'men'] += 1;
  return counts;
}
