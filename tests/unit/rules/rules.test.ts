import { describe, expect, test } from 'vitest';
import {
  IllegalTurnError,
  applyLegalTurn,
  applyTurn,
  gameResult,
  initialState,
  legalTurns,
  positionKey,
  setupPosition,
  turnPerft,
  type GameState,
} from '../../../shared/rules/index.ts';

const ids = (s: GameState) => legalTurns(s).map((t) => t.id).sort();
const play = (s: GameState, ...moves: string[]) => moves.reduce((acc, m) => applyTurn(acc, m), s);

describe('move generation', () => {
  // Reference sequence for English checkers from the starting position.
  const REFERENCE = [7, 49, 302, 1469, 7361, 36768, 179740, 845931];
  test.each(REFERENCE.map((n, i) => [i + 1, n] as const))('turnPerft(%i) = %i', (depth, expected) => {
    const s = initialState();
    expect(turnPerft(s.board, s.sideToMove, depth)).toBe(expected);
  });

  test('red moves first with the 7 standard opening moves', () => {
    const s = initialState();
    expect(s.sideToMove).toBe('red');
    expect(ids(s)).toEqual(['10-14', '10-15', '11-15', '11-16', '12-16', '9-13', '9-14']);
  });

  test('capture is mandatory: only the jump is legal when one exists', () => {
    expect(ids(setupPosition({ red: [9, 14], ivory: [18] }, 'red'))).toEqual(['14x23']);
  });

  test('free choice between a single and a double capture (no maximum-capture rule)', () => {
    expect(ids(setupPosition({ red: [12, 14], ivory: [16, 18, 27] }, 'red'))).toEqual(['12x19', '14x23x32']);
  });

  test('crowning ends the turn even when the new king could keep jumping', () => {
    const turns = legalTurns(setupPosition({ red: [24], ivory: [26, 27] }, 'red'));
    expect(turns.map((t) => t.id)).toEqual(['24x31']);
    expect(turns[0]?.promotes).toBe(true);
    expect(turns[0]?.landings).toEqual([31]);
  });

  test('men cannot capture backwards; kings can', () => {
    expect(ids(setupPosition({ red: [18], ivory: [14] }, 'red'))).toEqual(['18-22', '18-23']);
    expect(ids(setupPosition({ redKings: [18], ivory: [14] }, 'red'))).toEqual(['18x9']);
  });

  test('two routes sharing a first landing are distinct turns', () => {
    const turns = legalTurns(setupPosition({ red: [1], ivory: [6, 14, 15] }, 'red'));
    expect(turns.map((t) => t.id).sort()).toEqual(['1x10x17', '1x10x19']);
    expect(turns.find((t) => t.id === '1x10x17')?.captures).toEqual([6, 14]);
  });

  test('a man reaching the king row by a simple move is crowned', () => {
    const s = applyTurn(setupPosition({ red: [25], ivory: [4] }, 'red'), '25-29');
    expect(s.board[28]).toEqual({ side: 'red', king: true });
  });

  test('applyTurn rejects a turn that is not legal', () => {
    expect(() => applyTurn(initialState(), '1-5')).toThrow(IllegalTurnError);
  });

  test('a capture removes the jumped pieces', () => {
    const s = applyTurn(setupPosition({ red: [14], ivory: [18, 27] }, 'red'), '14x23x32');
    expect(s.board[17]).toBeNull();
    expect(s.board[26]).toBeNull();
    expect(s.board[31]).toEqual({ side: 'red', king: true });
  });
});

describe('results and draws', () => {
  test('a side with no pieces loses', () => {
    expect(gameResult(setupPosition({ ivory: [32] }, 'red'))).toEqual({ winner: 'ivory', reason: 'no-moves' });
  });

  test('a fully blocked side loses rather than drawing', () => {
    expect(gameResult(setupPosition({ red: [4], ivory: [8, 11] }, 'red'))).toEqual({
      winner: 'ivory',
      reason: 'no-moves',
    });
  });

  test('the third occurrence of a position is a draw, not the second', () => {
    const start = setupPosition({ redKings: [1], ivoryKings: [32] }, 'red');
    const cycle = ['1-6', '32-27', '6-1', '27-32'];
    const once = play(start, ...cycle);
    expect(gameResult(once)).toBeNull();
    const twice = play(once, ...cycle);
    expect(gameResult(twice)).toEqual({ winner: null, reason: 'repetition' });
  });

  test('the same board with a different side to move is a different position', () => {
    const s = setupPosition({ redKings: [1], ivoryKings: [32] }, 'red');
    expect(positionKey(s.board, 'red')).not.toBe(positionKey(s.board, 'ivory'));
  });

  test('40 quiet turns per side is a draw; 40 and 39 is not', () => {
    const s = setupPosition({ redKings: [1], ivoryKings: [32] }, 'red');
    expect(gameResult({ ...s, quietTurns: { red: 40, ivory: 39 } })).toBeNull();
    expect(gameResult({ ...s, quietTurns: { red: 40, ivory: 40 } })).toEqual({ winner: null, reason: 'forty-move' });
  });

  test('king moves count as quiet; a man move resets both counters', () => {
    const s = setupPosition({ redKings: [1], red: [12], ivoryKings: [32] }, 'red');
    const afterKing = play(s, '1-6');
    expect(afterKing.quietTurns).toEqual({ red: 1, ivory: 0 });
    const afterIvory = play(afterKing, '32-27');
    expect(afterIvory.quietTurns).toEqual({ red: 1, ivory: 1 });
    expect(play(afterIvory, '12-16').quietTurns).toEqual({ red: 0, ivory: 0 });
  });

  test('a capture resets both counters and the repetition history', () => {
    const s = setupPosition({ redKings: [14], ivory: [18], ivoryKings: [32] }, 'red');
    const counted = { ...s, quietTurns: { red: 12, ivory: 12 } };
    const turn = legalTurns(counted).find((t) => t.id === '14x23');
    expect(turn).toBeDefined();
    const next = applyLegalTurn(counted, turn!);
    expect(next.quietTurns).toEqual({ red: 0, ivory: 0 });
    expect(Object.values(next.positionCounts)).toEqual([1]);
  });

  test('no-moves is decided before the draw rules', () => {
    const s = setupPosition({ red: [4], ivory: [8, 11] }, 'red');
    expect(gameResult({ ...s, quietTurns: { red: 40, ivory: 40 } })?.reason).toBe('no-moves');
  });

  test('history records turn ids in order', () => {
    expect(play(initialState(), '11-15', '23-19').history).toEqual(['11-15', '23-19']);
  });
});
