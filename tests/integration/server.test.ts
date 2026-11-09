import { afterEach, describe, expect, test } from 'vitest';
import { legalTurns, type GameState } from '../../shared/rules/index.ts';
import { GameStore, type AiRunner } from '../../server/game/store.ts';
import { buildApp } from '../../server/http/app.ts';
import type { AiOutcome } from '../../server/game/lifecycle.ts';
import type { Snapshot } from '../../shared/contracts/index.ts';

const SECRET = 'sk-or-v1-never-leak-this';
type App = Awaited<ReturnType<typeof buildApp>>;
const apps: App[] = [];
afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});

/** Fake opponent: plays the first legal turn after `delayMs`, or fails if told to. */
function fakeAi(opts: { delayMs?: number; fail?: () => boolean } = {}) {
  const aborted: boolean[] = [];
  const runAi: AiRunner = (state: GameState, { signal, onStatus }) =>
    new Promise<AiOutcome>((resolve, reject) => {
      onStatus('analyzing');
      const t = setTimeout(() => {
        if (opts.fail?.()) return resolve({ ok: false, error: 'Jev unavailable: test' });
        const turn = legalTurns(state)[0]!;
        resolve({ ok: true, turnId: turn.id, ai: { turnId: turn.id, source: 'jev', provenance: 'searched', matchedEngineBest: true, engineBest: turn.id, score: 0, depth: 10, confidence: 0.9, model: 'fake', ms: 1 } });
      }, opts.delayMs ?? 20);
      signal.addEventListener('abort', () => {
        aborted.push(true);
        clearTimeout(t);
        reject(new Error('aborted'));
      });
    });
  return { runAi, aborted };
}

async function setup(ai = fakeAi(), storeOpts: { ttlMs?: number; now?: () => number } = {}) {
  const store = new GameStore({ runAi: ai.runAi, config: { model: 'typesafe/jev-1.14', jevReady: true, engine: 'marcher' }, ...storeOpts });
  const app = await buildApp({ store, health: () => ({ jevReady: true, model: 'typesafe/jev-1.14' }) });
  apps.push(app);
  const created = await app.inject({ method: 'POST', url: '/api/games', headers: { 'content-type': 'application/json' }, payload: {} });
  const cookie = String(created.headers['set-cookie']).split(';')[0]!;
  const snap = created.json() as Snapshot;
  let n = 0;
  const command = async (command: Record<string, unknown>, expectedVersion: number, commandId = `cmd-${Date.now()}-${n++}`) =>
    app.inject({
      method: 'POST',
      url: `/api/games/${snap.gameId}/commands`,
      headers: { 'content-type': 'application/json', cookie },
      payload: { commandId, expectedVersion, command },
    });
  const get = async () => (await app.inject({ method: 'GET', url: `/api/games/${snap.gameId}`, headers: { cookie } })).json() as Snapshot;
  const waitFor = async (pred: (s: Snapshot) => boolean, ms = 2000) => {
    const t0 = Date.now();
    for (;;) {
      const s = await get();
      if (pred(s)) return s;
      if (Date.now() - t0 > ms) throw new Error(`timeout; last phase ${s.phase}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  return { app, store, snap, cookie, command, get, waitFor, ai };
}

describe('HTTP game flow', () => {
  test('ready -> start -> human move -> AI reply, with no AI work before start', async () => {
    const { snap, command, waitFor } = await setup();
    expect(snap).toMatchObject({ lifecycle: 'ready', phase: null, legalTurns: [], moves: [] });
    const started = (await command({ type: 'start' }, 0)).json();
    expect(started.snapshot).toMatchObject({ lifecycle: 'playing', phase: 'human-input' });
    expect(started.snapshot.legalTurns).toHaveLength(7);
    const moved = (await command({ type: 'move', turnId: '11-15' }, 1)).json();
    expect(moved.snapshot.phase).toBe('ai-thinking');
    const after = await waitFor((s) => s.phase === 'human-input');
    expect(after.moves.map((m) => m.side)).toEqual(['red', 'ivory']);
    expect(after.moves[1]?.ai?.source).toBe('jev');
  });

  test('stale versions conflict; replayed command ids are idempotent; bad input is rejected', async () => {
    const { command } = await setup();
    const first = await command({ type: 'start' }, 0, 'same-command-id');
    const replay = await command({ type: 'start' }, 0, 'same-command-id');
    expect(replay.json()).toEqual(first.json());
    const stale = await command({ type: 'pause' }, 0);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ ok: false, error: 'stale', snapshot: { version: 1 } });
    expect((await command({ type: 'move', turnId: '1-5' }, 1)).statusCode).toBe(422);
    expect((await command({ type: 'teleport' }, 1)).statusCode).toBe(400);
  });

  test('other sessions cannot read or command the game; cross-site writes are refused', async () => {
    const { app, snap, cookie } = await setup();
    expect((await app.inject({ method: 'GET', url: `/api/games/${snap.gameId}` })).statusCode).toBe(403);
    const foreign = await app.inject({ method: 'POST', url: `/api/games/${snap.gameId}/commands`, headers: { 'content-type': 'application/json', cookie: 'cvj_owner=00000000-0000-0000-0000-000000000000' }, payload: { commandId: 'abcdefgh', expectedVersion: 0, command: { type: 'start' } } });
    expect(foreign.statusCode).toBe(403);
    const textPlain = await app.inject({ method: 'POST', url: `/api/games/${snap.gameId}/commands`, headers: { 'content-type': 'text/plain', cookie }, payload: '{}' });
    expect(textPlain.statusCode).toBe(415);
    const crossOrigin = await app.inject({ method: 'POST', url: `/api/games/${snap.gameId}/commands`, headers: { 'content-type': 'application/json', cookie, origin: 'https://evil.example', host: 'localhost' }, payload: { commandId: 'abcdefgh', expectedVersion: 0, command: { type: 'start' } } });
    expect(crossOrigin.statusCode).toBe(403);
  });

  test('pause during AI thinking aborts the job and freezes the board; resume finishes the turn', async () => {
    const ai = fakeAi({ delayMs: 150 });
    const { command, get, waitFor } = await setup(ai);
    await command({ type: 'start' }, 0);
    await command({ type: 'move', turnId: '11-15' }, 1);
    const paused = (await command({ type: 'pause' }, 2)).json();
    expect(paused.snapshot).toMatchObject({ lifecycle: 'paused', pausedPhase: 'ai-thinking' });
    expect(ai.aborted).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 250));
    expect((await get()).moves).toHaveLength(1);
    await command({ type: 'resume' }, 3);
    const done = await waitFor((s) => s.phase === 'human-input');
    expect(done.moves).toHaveLength(2);
  });

  test('restart during AI thinking discards the old job; its result cannot land in the new game', async () => {
    const ai = fakeAi({ delayMs: 120 });
    const { command, get } = await setup(ai);
    await command({ type: 'start' }, 0);
    await command({ type: 'move', turnId: '11-15' }, 1);
    const restarted = (await command({ type: 'restart' }, 2)).json();
    expect(restarted.snapshot).toMatchObject({ generation: 2, lifecycle: 'playing', phase: 'human-input', moves: [] });
    await new Promise((r) => setTimeout(r, 200));
    const s = await get();
    expect(s.moves).toEqual([]);
    expect(s.board.slice(0, 12).every((p) => p?.side === 'red')).toBe(true);
  });

  test('an AI failure shows ai-error without moving; retry recovers', async () => {
    let failures = 1;
    const { command, waitFor } = await setup(fakeAi({ fail: () => failures-- > 0 }));
    await command({ type: 'start' }, 0);
    await command({ type: 'move', turnId: '11-15' }, 1);
    const failed = await waitFor((s) => s.phase === 'ai-error');
    expect(failed).toMatchObject({ aiError: 'Jev unavailable: test' });
    expect(failed.moves).toHaveLength(1);
    await command({ type: 'retry-ai' }, failed.version);
    expect((await waitFor((s) => s.phase === 'human-input')).moves).toHaveLength(2);
  });

  test('expired sessions answer 404 with a start-new-game message', async () => {
    let clock = 0;
    const { store, get, app, snap, cookie } = await setup(fakeAi(), { ttlMs: 1000, now: () => clock });
    expect((await get()).lifecycle).toBe('ready');
    clock = 5000;
    expect(store.sweep()).toBe(1);
    const res = await app.inject({ method: 'GET', url: `/api/games/${snap.gameId}`, headers: { cookie } });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toContain('start a new game');
  });

  test('server-sent events deliver the current snapshot and later changes', async () => {
    const { app, snap, cookie, command } = await setup();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/games/${snap.gameId}/events`, { headers: { cookie }, signal: controller.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const events: Snapshot[] = [];
    let buffer = '';
    const readUntil = async (count: number) => {
      while (events.length < count) {
        const { value } = await reader.read();
        buffer += new TextDecoder().decode(value);
        let i;
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const data = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (data) events.push(JSON.parse(data.slice(6)));
        }
      }
    };
    await readUntil(1);
    expect(events[0]?.lifecycle).toBe('ready');
    await command({ type: 'start' }, 0);
    await readUntil(2);
    expect(events[1]?.lifecycle).toBe('playing');
    controller.abort();
  });

  test('the API key never appears in health or snapshot responses', async () => {
    process.env.OPENROUTER_API_KEY = SECRET;
    const { app, get, command } = await setup();
    await command({ type: 'start' }, 0);
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.body).not.toContain(SECRET);
    expect(JSON.stringify(await get())).not.toContain(SECRET);
    delete process.env.OPENROUTER_API_KEY;
  });
});
