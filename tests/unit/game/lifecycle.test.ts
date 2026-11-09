import { describe, expect, test } from 'vitest';
import { initialState, legalTurns, setupPosition } from '../../../shared/rules/index.ts';
import {
  newGame,
  reduceAiOutcome,
  reduceAiStatus,
  reduceCommand,
  type AiOutcome,
  type GameCore,
  type Reduction,
} from '../../../server/game/lifecycle.ts';
import type { AiMove, Command } from '../../../shared/contracts/index.ts';

let jobCounter = 0;
const nextJob = () => `job-${++jobCounter}`;
const ok = (r: Reduction) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r;
};
const run = (core: GameCore, ...commands: Command[]) => commands.reduce((c, cmd) => ok(reduceCommand(c, cmd, nextJob)).core, core);
const aiMove = (turnId: string): AiMove => ({
  turnId, source: 'jev', provenance: 'searched', matchedEngineBest: true, engineBest: turnId,
  score: 0, depth: 12, confidence: 0.9, model: 'test', ms: 10,
});
const aiOk = (core: GameCore): AiOutcome => {
  const turn = legalTurns(core.state)[0]!;
  return { ok: true, turnId: turn.id, ai: aiMove(turn.id) };
};

describe('lifecycle reducer', () => {
  test('a new game is ready; start begins exactly one game on the human turn', () => {
    const g = newGame('g');
    expect(g.lifecycle).toBe('ready');
    const started = ok(reduceCommand(g, { type: 'start' }, nextJob));
    expect(started.core).toMatchObject({ lifecycle: 'playing', phase: 'human-input', version: 1 });
    expect(started.effects).toEqual([]);
    expect(reduceCommand(started.core, { type: 'start' }, nextJob)).toMatchObject({ ok: false, error: 'not-ready' });
  });

  test('moves are rejected before start and when illegal', () => {
    expect(reduceCommand(newGame('g'), { type: 'move', turnId: '11-15' }, nextJob)).toMatchObject({ ok: false, error: 'not-your-turn' });
    const g = run(newGame('g'), { type: 'start' });
    expect(reduceCommand(g, { type: 'move', turnId: '11-16x' }, nextJob)).toMatchObject({ ok: false, error: 'illegal-move' });
  });

  test('a legal human move hands the turn to one AI job', () => {
    const g = run(newGame('g'), { type: 'start' });
    const r = ok(reduceCommand(g, { type: 'move', turnId: '11-15' }, nextJob));
    expect(r.core.phase).toBe('ai-thinking');
    expect(r.core.moves).toHaveLength(1);
    expect(r.effects).toEqual([{ type: 'start-ai', jobId: r.core.aiJobId }]);
    expect(reduceCommand(r.core, { type: 'move', turnId: '9-13' }, nextJob)).toMatchObject({ ok: false, error: 'not-your-turn' });
  });

  test('only the current job may commit; its move returns the turn to the human', () => {
    const g = run(newGame('g'), { type: 'start' }, { type: 'move', turnId: '11-15' });
    expect(reduceAiOutcome(g, 'someone-else', aiOk(g))).toBeNull();
    const next = reduceAiOutcome(g, g.aiJobId!, aiOk(g))!;
    expect(next).toMatchObject({ phase: 'human-input', aiJobId: null, version: g.version + 1 });
    expect(next.state.sideToMove).toBe('red');
    expect(next.moves[1]?.ai?.source).toBe('jev');
  });

  test('an AI outcome naming an illegal move becomes an AI error, never a move', () => {
    const g = run(newGame('g'), { type: 'start' }, { type: 'move', turnId: '11-15' });
    const next = reduceAiOutcome(g, g.aiJobId!, { ok: true, turnId: '1-5', ai: aiMove('1-5') })!;
    expect(next.phase).toBe('ai-error');
    expect(next.moves).toHaveLength(1);
  });

  test('pause during AI thinking cancels the job; its late result is ignored; resume starts a fresh job', () => {
    const g = run(newGame('g'), { type: 'start' }, { type: 'move', turnId: '11-15' });
    const oldJob = g.aiJobId!;
    const paused = ok(reduceCommand(g, { type: 'pause' }, nextJob));
    expect(paused.core).toMatchObject({ lifecycle: 'paused', pausedPhase: 'ai-thinking', aiJobId: null });
    expect(paused.effects).toEqual([{ type: 'cancel-ai' }]);
    expect(reduceAiOutcome(paused.core, oldJob, aiOk(g))).toBeNull();
    const resumed = ok(reduceCommand(paused.core, { type: 'resume' }, nextJob));
    expect(resumed.core).toMatchObject({ lifecycle: 'playing', phase: 'ai-thinking' });
    expect(resumed.core.aiJobId).not.toBe(oldJob);
    expect(resumed.effects).toEqual([{ type: 'start-ai', jobId: resumed.core.aiJobId }]);
  });

  test('pause on the human turn keeps the same board and turn', () => {
    const g = run(newGame('g'), { type: 'start' });
    const paused = run(g, { type: 'pause' });
    expect(reduceCommand(paused, { type: 'move', turnId: '11-15' }, nextJob)).toMatchObject({ ok: false, error: 'not-your-turn' });
    const resumed = run(paused, { type: 'resume' });
    expect(resumed).toMatchObject({ lifecycle: 'playing', phase: 'human-input' });
    expect(resumed.state).toBe(g.state);
    expect(reduceCommand(resumed, { type: 'resume' }, nextJob)).toMatchObject({ ok: false, error: 'not-paused' });
  });

  test('restart during AI thinking clears everything and rejects the old job', () => {
    const g = run(newGame('g'), { type: 'start' }, { type: 'move', turnId: '11-15' });
    const oldJob = g.aiJobId!;
    const r = ok(reduceCommand(g, { type: 'restart' }, nextJob));
    expect(r.core).toMatchObject({ lifecycle: 'playing', phase: 'human-input', generation: 2, moves: [], result: null, aiJobId: null });
    expect(r.core.state).toEqual(initialState());
    expect(r.effects).toEqual([{ type: 'cancel-ai' }]);
    expect(reduceAiOutcome(r.core, oldJob, aiOk(g))).toBeNull();
  });

  test('an AI failure becomes ai-error; retry starts a new job', () => {
    const g = run(newGame('g'), { type: 'start' }, { type: 'move', turnId: '11-15' });
    const failed = reduceAiOutcome(g, g.aiJobId!, { ok: false, error: 'Jev unavailable' })!;
    expect(failed).toMatchObject({ phase: 'ai-error', aiError: 'Jev unavailable', aiJobId: null });
    expect(failed.moves).toHaveLength(1);
    const retried = ok(reduceCommand(failed, { type: 'retry-ai' }, nextJob));
    expect(retried.core).toMatchObject({ phase: 'ai-thinking', aiError: null });
    expect(retried.effects[0]?.type).toBe('start-ai');
    expect(reduceCommand(retried.core, { type: 'retry-ai' }, nextJob)).toMatchObject({ ok: false, error: 'no-ai-error' });
  });

  test('a winning human move finishes the game; pause is unavailable; restart is Play again', () => {
    const g: GameCore = { ...newGame('g'), lifecycle: 'playing', phase: 'human-input', state: setupPosition({ red: [14], ivory: [18] }, 'red') };
    const done = ok(reduceCommand(g, { type: 'move', turnId: '14x23' }, nextJob)).core;
    expect(done).toMatchObject({ lifecycle: 'finished', phase: null, result: { winner: 'red', reason: 'no-moves' } });
    expect(reduceCommand(done, { type: 'pause' }, nextJob)).toMatchObject({ ok: false, error: 'not-playing' });
    expect(reduceCommand(done, { type: 'resume' }, nextJob)).toMatchObject({ ok: false, error: 'not-paused' });
    const again = run(done, { type: 'restart' });
    expect(again).toMatchObject({ lifecycle: 'playing', phase: 'human-input', result: null, moves: [] });
    expect(run(run(again, { type: 'restart' }), { type: 'restart' }).generation).toBe(done.generation + 3);
  });

  test('an AI move that wins finishes the game for ivory', () => {
    // Ivory's 26x17 captures red's last piece.
    const g: GameCore = { ...newGame('g'), lifecycle: 'playing', phase: 'ai-thinking', aiJobId: 'j', state: setupPosition({ red: [22], ivory: [26] }, 'ivory') };
    expect(legalTurns(g.state).map((t) => t.id)).toEqual(['26x17']);
    expect(reduceAiOutcome(g, 'j', { ok: true, turnId: '26x17', ai: aiMove('26x17') })).toMatchObject({
      lifecycle: 'finished',
      result: { winner: 'ivory', reason: 'no-moves' },
    });
  });

  test('AI status updates do not change the logical version', () => {
    const g = run(newGame('g'), { type: 'start' }, { type: 'move', turnId: '11-15' });
    const s = reduceAiStatus(g, g.aiJobId!, 'analyzing')!;
    expect(s.aiStatus).toBe('analyzing');
    expect(s.version).toBe(g.version);
    expect(reduceAiStatus(g, 'other', 'choosing')).toBeNull();
  });
});
