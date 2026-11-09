import { rowCol, type Board, type Side } from '../../../shared/rules/index.ts';

export interface MarcherPosition {
  p1: bigint;
  p2: bigint;
  p1k: bigint;
  p2k: bigint;
  player: 1 | 2;
}

// Marcher uses a 0–63 board index (row * 8 + col). Its player 1 owns the men
// that start on rows 5–7 and move toward row 0, which is our ivory side; player 2
// is red. Men and kings live in separate bitboards. The mapping is verified by
// perft and step-perft equivalence tests, not assumed.
export function toMarcher(board: Board, sideToMove: Side): MarcherPosition {
  let p1 = 0n;
  let p2 = 0n;
  let p1k = 0n;
  let p2k = 0n;
  board.forEach((piece, i) => {
    if (!piece) return;
    const [r, c] = rowCol(i + 1);
    const bit = 1n << BigInt(r * 8 + c);
    if (piece.side === 'ivory') {
      if (piece.king) p1k |= bit;
      else p1 |= bit;
    } else if (piece.king) p2k |= bit;
    else p2 |= bit;
  });
  return { p1, p2, p1k, p2k, player: sideToMove === 'ivory' ? 1 : 2 };
}
