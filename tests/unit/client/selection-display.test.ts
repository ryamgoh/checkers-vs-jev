import { describe, expect, test } from 'vitest';
import { initialState, legalTurns, setupPosition, applyTurn } from '../../../shared/rules/index.ts';
import { clickSquare, nextTargets, type Selection } from '../../../client/src/game/selection.ts';
import { enqueueOptimistic, finishAnimation, resetDisplay, syncDisplay, boardOf, sameBoard } from '../../../client/src/game/display.ts';
import type { MoveRecord, Snapshot } from '../../../shared/contracts/index.ts';

describe('click selection', () => {
  const s = initialState();
  const turns = legalTurns(s);

  test('select a movable piece, then a destination, commits the move', () => {
    const a = clickSquare(turns, s.board, null, 11);
    expect(a).toEqual({ kind: 'select', selection: { from: 11, landings: [] } });
    expect(clickSquare(turns, s.board, (a as { selection: Selection }).selection, 15)).toEqual({ kind: 'commit', turnId: '11-15' });
  });

  test('clicking a blocked piece or an empty square explains why', () => {
    expect(clickSquare(turns, s.board, null, 1)).toMatchObject({ kind: 'invalid', message: 'That piece has no legal moves.' });
    expect(clickSquare(turns, s.board, null, 16)).toMatchObject({ kind: 'invalid', selection: null });
    expect(clickSquare(turns, s.board, { from: 11, landings: [] }, 18)).toMatchObject({ kind: 'invalid', selection: { from: 11 } });
  });

  test('switching pieces before the first step is allowed; clicking the same piece deselects', () => {
    expect(clickSquare(turns, s.board, { from: 11, landings: [] }, 9)).toEqual({ kind: 'select', selection: { from: 9, landings: [] } });
    expect(clickSquare(turns, s.board, { from: 11, landings: [] }, 11)).toEqual({ kind: 'select', selection: null });
  });

  test('when a capture exists, other pieces explain that the capture is required', () => {
    const p = setupPosition({ red: [9, 14], ivory: [18] }, 'red');
    expect(clickSquare(legalTurns(p), p.board, null, 9)).toMatchObject({ kind: 'invalid', message: 'Capture required: a highlighted piece must jump.' });
  });

  test('a multi-jump is built step by step and only commits when complete', () => {
    const p = setupPosition({ red: [1], ivory: [6, 14, 15] }, 'red');
    const t = legalTurns(p);
    const sel = { from: 1, landings: [] };
    expect(nextTargets(t, sel)).toEqual(new Map([[10, 'capture']]));
    const step1 = clickSquare(t, p.board, sel, 10);
    expect(step1).toEqual({ kind: 'select', selection: { from: 1, landings: [10] } });
    const mid = (step1 as { selection: Selection }).selection;
    expect([...nextTargets(t, mid).keys()].sort()).toEqual([17, 19]);
    expect(clickSquare(t, p.board, mid, 5)).toMatchObject({ kind: 'invalid', message: expect.stringContaining('Finish the capture') });
    expect(clickSquare(t, p.board, mid, 19)).toEqual({ kind: 'commit', turnId: '1x10x19' });
  });
});

const snap = (over: Partial<Snapshot>): Snapshot => ({
  gameId: 'g', generation: 1, version: 1, lifecycle: 'playing', phase: 'human-input', pausedPhase: null,
  aiStatus: 'idle', aiError: null, board: initialState().board as Snapshot['board'], sideToMove: 'red',
  legalTurns: [], moves: [], result: null, quietTurns: { red: 0, ivory: 0 },
  config: { model: 'm', jevReady: true, engine: 'e' }, ...over,
});
const record = (turnId: string, side: 'red' | 'ivory', state = initialState()): MoveRecord => {
  const turn = legalTurns(state).find((t) => t.id === turnId)!;
  return { ply: state.ply + 1, side, turn: { ...turn, landings: [...turn.landings], captures: [...turn.captures] }, ai: null };
};

describe('display model', () => {
  test('new snapshot moves are queued, then applied when their animation finishes', () => {
    const d0 = resetDisplay(snap({}));
    const after = applyTurn(initialState(), '11-15');
    const s1 = snap({ moves: [record('11-15', 'red')], board: after.board as Snapshot['board'] });
    const d1 = syncDisplay(d0, s1);
    expect(d1.queue).toHaveLength(1);
    const d2 = finishAnimation(d1);
    expect(d2.queue).toHaveLength(0);
    expect(sameBoard(boardOf(d2.pieces), after.board)).toBe(true);
    expect(d2.pieces.find((p) => p.square === 15)?.id).toBe('g:1:11'); // identity follows the piece
  });

  test('an optimistic move is not animated twice when the server confirms it', () => {
    const d0 = resetDisplay(snap({}));
    const d1 = enqueueOptimistic(d0, record('11-15', 'red'));
    const confirmed = syncDisplay(d1, snap({ moves: [record('11-15', 'red')] }));
    expect(confirmed.queue).toHaveLength(1);
  });

  test('a rejected optimistic move resets the display to the server board', () => {
    const d1 = enqueueOptimistic(resetDisplay(snap({})), record('11-15', 'red'));
    const rejected = syncDisplay(d1, snap({ moves: [] }));
    expect(rejected.queue).toHaveLength(0);
    expect(sameBoard(boardOf(rejected.pieces), initialState().board)).toBe(true);
  });

  test('a restart (new generation) resets the display immediately', () => {
    const d1 = syncDisplay(resetDisplay(snap({})), snap({ moves: [record('11-15', 'red')] }));
    const restarted = syncDisplay(d1, snap({ generation: 2, moves: [] }));
    expect(restarted.key).toBe('g:2');
    expect(restarted.queue).toEqual([]);
  });
});
