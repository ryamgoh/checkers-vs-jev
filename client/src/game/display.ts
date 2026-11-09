import type { Board, Side } from '../../../shared/rules/types.ts';
import type { MoveRecord, Snapshot } from '../../../shared/contracts/index.ts';

export interface PieceView {
  readonly id: string;
  readonly square: number;
  readonly side: Side;
  readonly king: boolean;
}

export interface Display {
  /** gameId:generation the display belongs to. */
  readonly key: string;
  readonly pieces: readonly PieceView[];
  /** Snapshot moves already shown or queued for animation. */
  readonly shownMoves: number;
  readonly queue: readonly MoveRecord[];
}

export const displayKey = (s: Pick<Snapshot, 'gameId' | 'generation'>) => `${s.gameId}:${s.generation}`;

export function piecesFromBoard(board: Board, key: string): PieceView[] {
  return board.flatMap((p, i) => (p ? [{ id: `${key}:${i + 1}`, square: i + 1, side: p.side, king: p.king }] : []));
}

export function resetDisplay(s: Snapshot): Display {
  const key = displayKey(s);
  return { key, pieces: piecesFromBoard(s.board, key), shownMoves: s.moves.length, queue: [] };
}

export function applyRecord(pieces: readonly PieceView[], record: MoveRecord): PieceView[] {
  const { turn } = record;
  const dest = turn.landings[turn.landings.length - 1]!;
  const captured = new Set(turn.captures);
  return pieces
    .filter((p) => !captured.has(p.square))
    .map((p) => (p.square === turn.from ? { ...p, square: dest, king: p.king || turn.promotes } : p));
}

export function boardOf(pieces: readonly PieceView[]): Board {
  const board: ({ side: Side; king: boolean } | null)[] = Array.from({ length: 32 }, () => null);
  for (const p of pieces) board[p.square - 1] = { side: p.side, king: p.king };
  return board;
}

export const sameBoard = (a: Board, b: Board) =>
  a.every((p, i) => (p === null ? b[i] === null : b[i] !== null && b[i]!.side === p.side && b[i]!.king === p.king));

/** Folds a server snapshot into the display: queue new moves, or reset when out of step. */
export function syncDisplay(d: Display | null, s: Snapshot): Display {
  if (!d || d.key !== displayKey(s)) return resetDisplay(s);
  if (s.moves.length > d.shownMoves) {
    return { ...d, queue: [...d.queue, ...s.moves.slice(d.shownMoves)], shownMoves: s.moves.length };
  }
  if (s.moves.length < d.shownMoves) return resetDisplay(s); // e.g. an optimistic move was rejected
  if (d.queue.length === 0 && !sameBoard(boardOf(d.pieces), s.board)) return resetDisplay(s);
  return d;
}

/** Shows a locally submitted move at once, before the server confirms it. */
export function enqueueOptimistic(d: Display, record: MoveRecord): Display {
  return { ...d, queue: [...d.queue, record], shownMoves: d.shownMoves + 1 };
}

/** Completes the current animation. */
export function finishAnimation(d: Display): Display {
  const [current, ...rest] = d.queue;
  if (!current) return d;
  return { ...d, pieces: applyRecord(d.pieces, current), queue: rest };
}
