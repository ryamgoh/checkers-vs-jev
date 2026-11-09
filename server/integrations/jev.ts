import { z } from 'zod';
import { pieceCounts, type Board, type GameState, type Turn } from '../../shared/rules/index.ts';
import { FORCED_RESULT, type RankedTurns } from '../ai/engine-provider.ts';

export interface JevConfig {
  apiKey: string | undefined;
  model: string;
  timeoutMs: number;
  baseUrl: string;
  maxCallsPerDay: number;
}

export type JevOutcome =
  | { kind: 'choice'; turnId: string; confidence: number | null; model: string | null }
  | { kind: 'refusal' }
  | { kind: 'error'; retryable: boolean; status?: number; message: string };

export interface JevInput {
  state: GameState;
  /** Distinct legal turns, all offered to Jev. */
  turns: readonly Turn[];
  ranking: RankedTurns | null;
}

const ChoiceAnswer = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()).optional(),
  confidence: z.number().optional(),
});
const RefusalAnswer = z.object({ type: z.literal('refusal') });
const DecisionsResponse = z.object({
  model: z.string().optional(),
  answers: z.object({ move: z.union([ChoiceAnswer, RefusalAnswer]) }),
});

function describeTurn(board: Board, t: Turn): string {
  const mover = board[t.from - 1]?.king ? 'King' : 'Man';
  const crown = t.promotes ? ', crowned on arrival' : '';
  if (t.captures.length === 0) return `${mover} moves from ${t.from} to ${t.landings[0]}${crown}`;
  const route = [t.from, ...t.landings].join(' → ');
  const n = t.captures.length;
  return `${mover} jumps ${route}, capturing ${n} piece${n > 1 ? 's' : ''} (on ${t.captures.join(', ')})${crown}`;
}

export function describeEval(score: number, bestScore: number): string {
  if (score >= FORCED_RESULT) return 'wins by force';
  if (score <= -FORCED_RESULT) return 'loses by force';
  const shown = `score ${score > 0 ? '+' : ''}${score}`;
  const delta = bestScore - score;
  if (delta <= 0) return `best move (${shown})`;
  if (delta <= 15) return `about equal to the best move (${shown})`;
  const halves = Math.max(1, Math.round(delta / 60));
  const men = halves === 1 ? 'half a man' : halves === 2 ? '1 man' : `${halves / 2} men`;
  return `worse than the best move by about ${men} (${shown})`;
}

export function buildJevRequest(input: JevInput, model: string): Record<string, unknown> {
  const { state, turns, ranking } = input;
  const squares = (side: 'red' | 'ivory', king: boolean) =>
    state.board.flatMap((p, i) => (p && p.side === side && p.king === king ? [i + 1] : []));
  const counts = pieceCounts(state.board);
  const scores = new Map(ranking?.candidates.map((c) => [c.turnId, c.score]) ?? []);
  const bestScore = ranking?.candidates[0]?.score ?? 0;

  const criteria = Object.fromEntries(
    turns.map((t) => {
      const option: Record<string, string> = { move: describeTurn(state.board, t) };
      const score = scores.get(t.id);
      if (score !== undefined) option.engine = describeEval(score, bestScore);
      return [t.id, option];
    }),
  );

  const instructions = ranking
    ? 'You are playing ivory. Choose the strongest move. Every option is legal. A search engine has evaluated each option ("engine"): prefer the best evaluation, take a forced win whenever one is listed, and never choose a move that loses by force or gives up material when a better-rated move exists.'
    : 'You are playing ivory. Choose the strongest move. Every option is legal. Play to win: prefer captures that gain material, keep your back rank, and avoid leaving pieces where they can be jumped.';

  return {
    model,
    state: {
      game: 'American/English checkers (WCDF rules) on an 8x8 board. Squares are numbered 1-32 in standard notation. Captures are mandatory and multi-jumps must be completed.',
      you: 'ivory: men start on 21-32, move toward 1-4 and are crowned there',
      opponent: 'red: men start on 1-12 and move toward 29-32',
      position: {
        ivory_men: squares('ivory', false),
        ivory_kings: squares('ivory', true),
        red_men: squares('red', false),
        red_kings: squares('red', true),
      },
      material: `ivory ${counts.ivory.men} men, ${counts.ivory.kings} kings; red ${counts.red.men} men, ${counts.red.kings} kings`,
      move_number: Math.floor(state.ply / 2) + 1,
      recent_moves: state.history.slice(-12),
    },
    questions: { move: { type: 'choice', instructions, criteria } },
  };
}

export class JevClient {
  private day = '';
  private callsToday = 0;

  constructor(
    private readonly config: JevConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get ready(): boolean {
    return Boolean(this.config.apiKey);
  }

  get model(): string {
    return this.config.model;
  }

  async choose(input: JevInput, opts: { signal: AbortSignal }): Promise<JevOutcome> {
    if (!this.config.apiKey) return { kind: 'error', retryable: false, message: 'OPENROUTER_API_KEY is not configured on the server.' };
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.callsToday = 0;
    }
    if (this.callsToday >= this.config.maxCallsPerDay) {
      return { kind: 'error', retryable: false, message: `Daily Jev call limit (${this.config.maxCallsPerDay}) reached.` };
    }
    this.callsToday++;

    const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(this.config.timeoutMs)]);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.config.baseUrl}/api/alpha/decisions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildJevRequest(input, this.config.model)),
        signal,
      });
    } catch (err) {
      if (opts.signal.aborted) throw err;
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      return { kind: 'error', retryable: true, message: timedOut ? 'Jev timed out.' : 'Could not reach OpenRouter.' };
    }

    if (!res.ok) {
      const status = res.status;
      const retryable = status === 408 || status === 429 || status >= 500;
      const reason =
        status === 401 || status === 403
          ? 'OpenRouter rejected the API key.'
          : status === 402
            ? 'The OpenRouter account is out of credits.'
            : status === 429
              ? 'OpenRouter rate limit reached.'
              : `OpenRouter returned HTTP ${status}.`;
      return { kind: 'error', retryable, status, message: reason };
    }

    const parsed = DecisionsResponse.safeParse(await res.json().catch(() => null));
    if (!parsed.success) return { kind: 'error', retryable: true, message: 'Jev returned an unexpected response.' };
    const answer = parsed.data.answers.move;
    if (answer.type === 'refusal') return { kind: 'refusal' };
    return { kind: 'choice', turnId: answer.choice, confidence: answer.confidence ?? null, model: parsed.data.model ?? null };
  }
}
