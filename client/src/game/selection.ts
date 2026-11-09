import type { Board, Turn } from '../../../shared/rules/types.ts';

export interface Selection {
  readonly from: number;
  /** Landings chosen so far in a multi-jump (empty until the first step). */
  readonly landings: readonly number[];
}

export type ClickResult =
  | { kind: 'select'; selection: Selection | null }
  | { kind: 'commit'; turnId: string }
  | { kind: 'invalid'; message: string; selection: Selection | null };

const startsWith = (a: readonly number[], prefix: readonly number[]) => prefix.every((v, i) => a[i] === v);

export const captureRequired = (turns: readonly Turn[]) => turns.some((t) => t.captures.length > 0);
export const movablePieces = (turns: readonly Turn[]) => new Set(turns.map((t) => t.from));

/** Turns still consistent with the selection. */
export function routeCandidates(turns: readonly Turn[], sel: Selection | null): Turn[] {
  if (!sel) return [];
  return turns.filter((t) => t.from === sel.from && startsWith(t.landings, sel.landings));
}

/** Next squares the selected piece may land on, each tagged as a capture or a plain move. */
export function nextTargets(turns: readonly Turn[], sel: Selection | null): Map<number, 'move' | 'capture'> {
  const out = new Map<number, 'move' | 'capture'>();
  for (const t of routeCandidates(turns, sel)) {
    const next = t.landings[sel!.landings.length];
    if (next !== undefined) out.set(next, t.captures.length > 0 ? 'capture' : 'move');
  }
  return out;
}

export function clickSquare(turns: readonly Turn[], board: Board, sel: Selection | null, sq: number): ClickResult {
  // Mid-capture: only the next landing square of this piece is allowed.
  if (sel && sel.landings.length > 0) {
    const targets = nextTargets(turns, sel);
    if (!targets.has(sq)) return { kind: 'invalid', message: 'Finish the capture: choose a highlighted landing square.', selection: sel };
    return advance(turns, sel, sq);
  }

  const piece = board[sq - 1];
  if (piece && piece.side === 'red') {
    if (sel && sel.from === sq) return { kind: 'select', selection: null };
    if (movablePieces(turns).has(sq)) return { kind: 'select', selection: { from: sq, landings: [] } };
    return {
      kind: 'invalid',
      message: captureRequired(turns) ? 'Capture required: a highlighted piece must jump.' : 'That piece has no legal moves.',
      selection: sel,
    };
  }

  if (sel && nextTargets(turns, sel).has(sq)) return advance(turns, sel, sq);
  if (!sel) return { kind: 'invalid', message: 'Select one of your red pieces first.', selection: null };
  return { kind: 'invalid', message: 'That is not a legal destination.', selection: sel };
}

function advance(turns: readonly Turn[], sel: Selection, sq: number): ClickResult {
  const landings = [...sel.landings, sq];
  // A route that can continue must continue, so an exact match is always complete.
  const complete = turns.find((t) => t.from === sel.from && t.landings.length === landings.length && startsWith(t.landings, landings));
  if (complete) return { kind: 'commit', turnId: complete.id };
  return { kind: 'select', selection: { from: sel.from, landings } };
}
