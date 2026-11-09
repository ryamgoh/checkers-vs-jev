import { directionsFor, isKingRow, jump, step } from './geometry.ts';
import { applyToBoard, distinctTurns, generateTurns } from './movegen.ts';
import { other } from './types.ts';
import type { Board, Piece, Side, Square } from './types.ts';

/** Leaf count after `depth` complete turns, counting identical-result routes once (standard convention). */
export function turnPerft(board: Board, side: Side, depth: number): number {
  if (depth === 0) return 1;
  const turns = distinctTurns(generateTurns(board, side));
  if (depth === 1) return turns.length;
  let n = 0;
  for (const t of turns) n += turnPerft(applyToBoard(board, t), other(side), depth - 1);
  return n;
}

interface Step {
  from: Square;
  to: Square;
  capture: Square;
  promotes: boolean;
}

function jumpsFrom(board: Board, sq: Square, piece: Piece, out: Step[]): void {
  for (const d of directionsFor(piece.side, piece.king)) {
    const mid = step(sq, d);
    const land = jump(sq, d);
    if (!mid || !land || board[land - 1]) continue;
    const victim = board[mid - 1];
    if (victim && victim.side !== piece.side) {
      out.push({ from: sq, to: land, capture: mid, promotes: !piece.king && isKingRow(land, piece.side) });
    }
  }
}

function generateSteps(board: Board, side: Side, forced: Square): Step[] {
  const out: Step[] = [];
  if (forced) {
    jumpsFrom(board, forced, board[forced - 1] as Piece, out);
    return out;
  }
  for (let sq = 1; sq <= 32; sq++) {
    const p = board[sq - 1];
    if (p && p.side === side) jumpsFrom(board, sq, p, out);
  }
  if (out.length > 0) return out;
  for (let sq = 1; sq <= 32; sq++) {
    const p = board[sq - 1];
    if (!p || p.side !== side) continue;
    for (const d of directionsFor(side, p.king)) {
      const to = step(sq, d);
      if (to && !board[to - 1]) out.push({ from: sq, to, capture: 0, promotes: !p.king && isKingRow(to, side) });
    }
  }
  return out;
}

function applyStep(board: Board, s: Step): Board {
  const next = board.slice();
  const piece = next[s.from - 1] as Piece;
  next[s.from - 1] = null;
  if (s.capture) next[s.capture - 1] = null;
  next[s.to - 1] = s.promotes ? { side: piece.side, king: true } : piece;
  return next;
}

/**
 * Leaf count where every single jump is one ply and the same side continues
 * a multi-jump with the same piece. This mirrors Marcher's perft convention,
 * so the two rule implementations can be compared exactly.
 *
 * `anyPieceContinues` reproduces a quirk of Marcher's perft counter
 * (`n_ply_search`): mid-jump it lists every capture for the side, not just the
 * jumping piece's. Marcher's search itself enforces same-piece continuation
 * (USE_FORCED_CONTINUATION / forced_pos), so the option exists only to compare
 * move generators like for like. Game rules never use it.
 */
export function stepPerft(
  board: Board,
  side: Side,
  depth: number,
  forced: Square = 0,
  opts: { anyPieceContinues?: boolean } = {},
): number {
  if (depth === 0) return 1;
  let n = 0;
  const steps = forced && opts.anyPieceContinues ? anyPieceJumps(board, side) : generateSteps(board, side, forced);
  for (const s of steps) {
    const next = applyStep(board, s);
    const continues: Step[] = [];
    if (s.capture && !s.promotes) jumpsFrom(next, s.to, next[s.to - 1] as Piece, continues);
    n += continues.length > 0 ? stepPerft(next, side, depth - 1, s.to, opts) : stepPerft(next, other(side), depth - 1, 0, opts);
  }
  return n;
}

function anyPieceJumps(board: Board, side: Side): Step[] {
  const out: Step[] = [];
  for (let sq = 1; sq <= 32; sq++) {
    const p = board[sq - 1];
    if (p && p.side === side) jumpsFrom(board, sq, p, out);
  }
  return out;
}
