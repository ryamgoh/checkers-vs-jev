import { directionsFor, isKingRow, jump, step } from './geometry.ts';
import type { Board, Piece, Side, Square, Turn } from './types.ts';

function makeTurn(from: Square, landings: Square[], captures: Square[], promotes: boolean): Turn {
  const id = captures.length > 0 ? [from, ...landings].join('x') : `${from}-${landings[0]}`;
  return { id, from, landings, captures, promotes };
}

function collectJumps(
  board: Board,
  side: Side,
  origin: Square,
  king: boolean,
  current: Square,
  landings: Square[],
  captures: Square[],
  out: Turn[],
): void {
  let extended = false;
  for (const d of directionsFor(side, king)) {
    const mid = step(current, d);
    const land = jump(current, d);
    if (!mid || !land) continue;
    const victim = board[mid - 1];
    if (!victim || victim.side === side || captures.includes(mid)) continue;
    // The moving piece has left its origin, so a king may land back on it.
    if (land !== origin && board[land - 1]) continue;
    extended = true;
    const nextLandings = [...landings, land];
    const nextCaptures = [...captures, mid];
    if (!king && isKingRow(land, side)) {
      // Crowning ends the turn immediately, even mid-capture.
      out.push(makeTurn(origin, nextLandings, nextCaptures, true));
      continue;
    }
    collectJumps(board, side, origin, king, land, nextLandings, nextCaptures, out);
  }
  if (!extended && landings.length > 0) out.push(makeTurn(origin, landings, captures, false));
}

/** All legal complete turns. Captures are mandatory; any capture route may be chosen. */
export function generateTurns(board: Board, side: Side): Turn[] {
  const captures: Turn[] = [];
  for (let sq = 1; sq <= 32; sq++) {
    const p = board[sq - 1];
    if (p && p.side === side) collectJumps(board, side, sq, p.king, sq, [], [], captures);
  }
  if (captures.length > 0) return captures;

  const moves: Turn[] = [];
  for (let sq = 1; sq <= 32; sq++) {
    const p = board[sq - 1];
    if (!p || p.side !== side) continue;
    for (const d of directionsFor(side, p.king)) {
      const to = step(sq, d);
      if (to && !board[to - 1]) moves.push(makeTurn(sq, [to], [], !p.king && isKingRow(to, side)));
    }
  }
  return moves;
}

/** Board after a complete turn (no legality check). */
export function applyToBoard(board: Board, turn: Turn): Board {
  const next = board.slice();
  const piece = next[turn.from - 1] as Piece;
  const dest = turn.landings[turn.landings.length - 1] as Square;
  next[turn.from - 1] = null;
  for (const c of turn.captures) next[c - 1] = null;
  next[dest - 1] = turn.promotes ? { side: piece.side, king: true } : piece;
  return next;
}

/**
 * Collapses routes that capture the same pieces and finish on the same square
 * (possible only with kings). They produce identical positions.
 */
export function distinctTurns(turns: readonly Turn[]): Turn[] {
  const seen = new Set<string>();
  const out: Turn[] = [];
  for (const t of turns) {
    const key = `${t.from}:${t.landings[t.landings.length - 1]}:${[...t.captures].sort((a, b) => a - b).join(',')}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}
