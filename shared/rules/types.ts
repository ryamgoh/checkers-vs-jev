// Core types for American/English (WCDF) checkers.
// Squares use standard 1–32 numbering. Red starts on 1–12 and moves first,
// toward 29–32; ivory starts on 21–32 and moves toward 1–4.

export type Side = 'red' | 'ivory';
export type Square = number;

export interface Piece {
  readonly side: Side;
  readonly king: boolean;
}

/** 32 entries; index = square − 1. */
export type Board = ReadonlyArray<Piece | null>;

/** One complete turn: a simple move, or a full capture route. */
export interface Turn {
  /** PDN style: "11-15" for a move, "15x24x31" for a capture (origin plus every landing). */
  readonly id: string;
  readonly from: Square;
  readonly landings: readonly Square[];
  readonly captures: readonly Square[];
  readonly promotes: boolean;
}

export interface GameState {
  readonly board: Board;
  readonly sideToMove: Side;
  readonly ply: number;
  readonly history: readonly string[];
  /** Occurrences of each position (board + side to move) since the last irreversible move. */
  readonly positionCounts: Readonly<Record<string, number>>;
  /** Completed turns per side without a capture or a man move. */
  readonly quietTurns: Readonly<Record<Side, number>>;
}

export type DrawReason = 'repetition' | 'forty-move';

export interface GameResult {
  readonly winner: Side | null;
  readonly reason: 'no-moves' | DrawReason;
}

export const other = (side: Side): Side => (side === 'red' ? 'ivory' : 'red');

export class IllegalTurnError extends Error {
  constructor(readonly turnId: string) {
    super(`Illegal turn: ${turnId}`);
    this.name = 'IllegalTurnError';
  }
}
