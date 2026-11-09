import { describe, expect, test, vi } from 'vitest';
import { distinctTurns, initialState, legalTurns } from '../../../shared/rules/index.ts';
import { JevClient, buildJevRequest, describeEval, type JevConfig } from '../../../server/integrations/jev.ts';
import type { RankedTurns } from '../../../server/ai/engine-provider.ts';

const state = initialState();
const turns = distinctTurns(legalTurns(state));
const ranking: RankedTurns = {
  best: '11-15',
  provenance: 'searched',
  candidates: [
    { turnId: '11-15', score: 12, depth: 14 },
    { turnId: '10-15', score: 5, depth: 14 },
    ...turns.filter((t) => !['11-15', '10-15'].includes(t.id)).map((t) => ({ turnId: t.id, score: -150, depth: 14 })),
  ],
};
const config: JevConfig = { apiKey: 'sk-test', model: 'typesafe/jev-1.14', timeoutMs: 1000, baseUrl: 'https://openrouter.example', maxCallsPerDay: 100 };
const respond = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
const choiceBody = (choice: string) => ({ model: 'typesafe/jev-1.14-20261014', answers: { move: { type: 'choice', choice, probabilities: { [choice]: 0.95 }, confidence: 0.94 } } });
const input = { state, turns, ranking };
const signal = () => new AbortController().signal;

describe('buildJevRequest', () => {
  test('offers every legal turn as a choice criterion, annotated with the engine evaluation', () => {
    const body = buildJevRequest(input, 'typesafe/jev-1.14') as {
      model: string;
      state: Record<string, unknown>;
      questions: { move: { type: string; instructions: string; criteria: Record<string, { move: string; engine?: string }> } };
    };
    expect(body.model).toBe('typesafe/jev-1.14');
    expect(body.questions.move.type).toBe('choice');
    expect(Object.keys(body.questions.move.criteria).sort()).toEqual(turns.map((t) => t.id).sort());
    expect(body.questions.move.criteria['11-15']).toEqual({ move: 'Man moves from 11 to 15', engine: 'best move (score +12)' });
    expect(body.questions.move.criteria['10-15']?.engine).toBe('about equal to the best move (score +5)');
    expect(body.questions.move.criteria['9-13']?.engine).toBe('worse than the best move by about 1.5 men (score -150)');
    expect(body.state).toMatchObject({ you: expect.stringContaining('ivory'), move_number: 1 });
  });

  test('without a ranking, criteria carry no engine field', () => {
    const body = buildJevRequest({ state, turns, ranking: null }, 'm') as { questions: { move: { criteria: Record<string, object> } } };
    expect(Object.values(body.questions.move.criteria).every((c) => !('engine' in c))).toBe(true);
  });

  test('describeEval labels forced results and margins', () => {
    expect(describeEval(3990, 3990)).toBe('wins by force');
    expect(describeEval(-3990, 0)).toBe('loses by force');
    expect(describeEval(0, 0)).toBe('best move (score 0)');
    expect(describeEval(-60, 0)).toBe('worse than the best move by about half a man (score -60)');
    expect(describeEval(-120, 0)).toBe('worse than the best move by about 1 man (score -120)');
  });
});

describe('JevClient.choose', () => {
  test('posts to the Decisions API with the server-side key and returns the choice', async () => {
    const fetchImpl = respond(200, choiceBody('11-15'));
    const out = await new JevClient(config, fetchImpl as unknown as typeof fetch).choose(input, { signal: signal() });
    expect(out).toEqual({ kind: 'choice', turnId: '11-15', confidence: 0.94, model: 'typesafe/jev-1.14-20261014' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openrouter.example/api/alpha/decisions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body as string).model).toBe('typesafe/jev-1.14');
  });

  test('maps HTTP failures to retryable or not', async () => {
    const run = async (status: number) => new JevClient(config, respond(status, { error: {} }) as unknown as typeof fetch).choose(input, { signal: signal() });
    expect(await run(401)).toMatchObject({ kind: 'error', retryable: false, message: 'OpenRouter rejected the API key.' });
    expect(await run(402)).toMatchObject({ kind: 'error', retryable: false });
    expect(await run(429)).toMatchObject({ kind: 'error', retryable: true });
    expect(await run(503)).toMatchObject({ kind: 'error', retryable: true });
  });

  test('malformed answers and refusals are reported, not guessed', async () => {
    const bad = await new JevClient(config, respond(200, { answers: {} }) as unknown as typeof fetch).choose(input, { signal: signal() });
    expect(bad).toMatchObject({ kind: 'error', retryable: true });
    const refusal = await new JevClient(config, respond(200, { answers: { move: { type: 'refusal', reason: 'x' } } }) as unknown as typeof fetch).choose(input, { signal: signal() });
    expect(refusal).toEqual({ kind: 'refusal' });
  });

  test('network errors and timeouts are retryable', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await new JevClient(config, down as unknown as typeof fetch).choose(input, { signal: signal() })).toMatchObject({ kind: 'error', retryable: true, message: 'Could not reach OpenRouter.' });
    const hang = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))));
    const out = await new JevClient({ ...config, timeoutMs: 30 }, hang as unknown as typeof fetch).choose(input, { signal: signal() });
    expect(out).toMatchObject({ kind: 'error', retryable: true, message: 'Jev timed out.' });
  });

  test('a missing key or the daily cap blocks calls before any spend', async () => {
    const fetchImpl = respond(200, choiceBody('11-15'));
    expect(await new JevClient({ ...config, apiKey: undefined }, fetchImpl as unknown as typeof fetch).choose(input, { signal: signal() })).toMatchObject({ kind: 'error', retryable: false });
    const capped = new JevClient({ ...config, maxCallsPerDay: 1 }, fetchImpl as unknown as typeof fetch);
    expect((await capped.choose(input, { signal: signal() })).kind).toBe('choice');
    expect(await capped.choose(input, { signal: signal() })).toMatchObject({ kind: 'error', retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
