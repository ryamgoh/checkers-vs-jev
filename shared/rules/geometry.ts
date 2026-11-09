import type { Side, Square } from './types.ts';

// Row 0 holds squares 1–4 (red's back rank); row 7 holds 29–32 (ivory's back rank).
// Playable (dark) squares are those where row + column is odd, so square 1 is
// (0,1) and square 4 sits in the single corner at (0,7).

export function rowCol(sq: Square): [row: number, col: number] {
  const i = sq - 1;
  const row = Math.floor(i / 4);
  const k = i % 4;
  return [row, row % 2 === 0 ? 2 * k + 1 : 2 * k];
}

/** Square at (row, col), or 0 when off the board or on a light square. */
export function squareAt(row: number, col: number): Square {
  if (row < 0 || row > 7 || col < 0 || col > 7) return 0;
  if ((row + col) % 2 === 0) return 0;
  return row * 4 + Math.floor(col / 2) + 1;
}

/** Diagonal directions: 0 up-left, 1 up-right, 2 down-left, 3 down-right ("up" = toward row 0). */
export const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

const STEP = new Int8Array(33 * 4);
const JUMP = new Int8Array(33 * 4);
for (let sq = 1; sq <= 32; sq++) {
  const [r, c] = rowCol(sq);
  DIRECTIONS.forEach(([dr, dc], d) => {
    STEP[sq * 4 + d] = squareAt(r + dr, c + dc);
    JUMP[sq * 4 + d] = squareAt(r + 2 * dr, c + 2 * dc);
  });
}

export const step = (sq: Square, d: number): Square => STEP[sq * 4 + d] ?? 0;
export const jump = (sq: Square, d: number): Square => JUMP[sq * 4 + d] ?? 0;

const RED_FORWARD = [2, 3] as const;
const IVORY_FORWARD = [0, 1] as const;
const ALL = [0, 1, 2, 3] as const;

export function directionsFor(side: Side, king: boolean): readonly number[] {
  if (king) return ALL;
  return side === 'red' ? RED_FORWARD : IVORY_FORWARD;
}

export function isKingRow(sq: Square, side: Side): boolean {
  return side === 'red' ? sq >= 29 : sq <= 4;
}
