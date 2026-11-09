import { rowCol, squareAt } from '../../../shared/rules/geometry.ts';

// You play red from the near side. Board rows run away from you (row 0 = your back rank)
// and columns are mirrored so that square 4, your single corner, sits at your left.
export function squareToXZ(sq: number): [x: number, z: number] {
  const [r, c] = rowCol(sq);
  return [3.5 - c, 3.5 - r];
}

/** Playable square under a point on the board surface, or 0. */
export function pointToSquare(x: number, z: number): number {
  return squareAt(Math.floor(4 - z), Math.floor(4 - x));
}

/** Canvas cell (column j, row i from the top-left, as seen by the player) -> board row/col. */
export const canvasCellToRowCol = (i: number, j: number): [row: number, col: number] => [7 - i, 7 - j];
