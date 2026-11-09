import { randomUUID } from 'node:crypto';
import type { GameState } from '../../shared/rules/index.ts';
import type { AiStatus, CommandRequest, CommandResponse, Snapshot } from '../../shared/contracts/index.ts';
import {
  HUMAN,
  newGame,
  reduceAiOutcome,
  reduceAiStatus,
  reduceCommand,
  type AiOutcome,
  type GameCore,
} from './lifecycle.ts';
import { toSnapshot, type SnapshotConfig } from './snapshot.ts';

export type AiRunner = (
  state: GameState,
  opts: { signal: AbortSignal; onStatus: (status: AiStatus) => void },
) => Promise<AiOutcome>;

interface Entry {
  core: GameCore;
  ownerId: string;
  touchedAt: number;
  controller: AbortController | null;
  listeners: Set<(s: Snapshot) => void>;
  recentCommands: Map<string, CommandResponse>;
}

export interface StoreOptions {
  runAi: AiRunner;
  config: SnapshotConfig;
  ttlMs?: number;
  now?: () => number;
  log?: (event: string, data: Record<string, unknown>) => void;
}

const MAX_RECENT_COMMANDS = 64;

export class GameStore {
  private readonly games = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: StoreOptions) {
    this.ttlMs = opts.ttlMs ?? 2 * 60 * 60 * 1000;
    this.now = opts.now ?? Date.now;
  }

  create(ownerId: string): Snapshot {
    const core = newGame(randomUUID());
    this.games.set(core.gameId, {
      core,
      ownerId,
      touchedAt: this.now(),
      controller: null,
      listeners: new Set(),
      recentCommands: new Map(),
    });
    return this.snapshot(core);
  }

  /** Snapshot for the owner, or an error tag. */
  get(gameId: string, ownerId: string): Snapshot | 'not-found' | 'forbidden' {
    const entry = this.games.get(gameId);
    if (!entry) return 'not-found';
    if (entry.ownerId !== ownerId) return 'forbidden';
    entry.touchedAt = this.now();
    return this.snapshot(entry.core);
  }

  subscribe(gameId: string, ownerId: string, fn: (s: Snapshot) => void): (() => void) | 'not-found' | 'forbidden' {
    const entry = this.games.get(gameId);
    if (!entry) return 'not-found';
    if (entry.ownerId !== ownerId) return 'forbidden';
    entry.listeners.add(fn);
    return () => entry.listeners.delete(fn);
  }

  /** Commands are applied synchronously, so they are serialized per game. */
  dispatch(gameId: string, ownerId: string, req: CommandRequest): CommandResponse {
    const entry = this.games.get(gameId);
    if (!entry) return { ok: false, error: 'not-found', message: 'Session expired — start a new game.', snapshot: null };
    if (entry.ownerId !== ownerId) return { ok: false, error: 'forbidden', message: 'This game belongs to another session.', snapshot: null };
    entry.touchedAt = this.now();

    const cached = entry.recentCommands.get(req.commandId);
    if (cached) return cached;

    let response: CommandResponse;
    if (req.expectedVersion !== entry.core.version) {
      response = { ok: false, error: 'stale', message: 'The game changed; showing the latest state.', snapshot: this.snapshot(entry.core) };
    } else {
      const reduced = reduceCommand(entry.core, req.command, () => randomUUID());
      if (!reduced.ok) {
        response = { ok: false, error: reduced.error, message: reduced.message, snapshot: this.snapshot(entry.core) };
      } else {
        entry.core = reduced.core;
        for (const effect of reduced.effects) {
          if (effect.type === 'cancel-ai') this.cancelAi(entry);
          else this.startAi(entry, effect.jobId);
        }
        response = { ok: true, snapshot: this.snapshot(entry.core) };
        this.broadcast(entry);
        this.opts.log?.('command', { gameId, type: req.command.type, version: entry.core.version });
      }
    }
    entry.recentCommands.set(req.commandId, response);
    if (entry.recentCommands.size > MAX_RECENT_COMMANDS) {
      const oldest = entry.recentCommands.keys().next().value;
      if (oldest !== undefined) entry.recentCommands.delete(oldest);
    }
    return response;
  }

  /** Removes games idle for longer than the TTL. */
  sweep(): number {
    let removed = 0;
    const cutoff = this.now() - this.ttlMs;
    for (const [id, entry] of this.games) {
      if (entry.touchedAt < cutoff && entry.listeners.size === 0) {
        this.cancelAi(entry);
        this.games.delete(id);
        removed++;
      }
    }
    return removed;
  }

  size(): number {
    return this.games.size;
  }

  private snapshot(core: GameCore): Snapshot {
    return toSnapshot(core, this.opts.config, HUMAN);
  }

  private broadcast(entry: Entry): void {
    const snap = this.snapshot(entry.core);
    for (const fn of entry.listeners) fn(snap);
  }

  private cancelAi(entry: Entry): void {
    entry.controller?.abort();
    entry.controller = null;
  }

  private startAi(entry: Entry, jobId: string): void {
    this.cancelAi(entry);
    const controller = new AbortController();
    entry.controller = controller;
    const gameId = entry.core.gameId;
    const started = this.now();
    const onStatus = (status: AiStatus) => {
      const next = reduceAiStatus(entry.core, jobId, status);
      if (next) {
        entry.core = next;
        this.broadcast(entry);
      }
    };
    this.opts
      .runAi(entry.core.state, { signal: controller.signal, onStatus })
      .catch((err: unknown): AiOutcome => {
        if (controller.signal.aborted) return { ok: false, error: 'aborted' };
        return { ok: false, error: `AI failed: ${err instanceof Error ? err.message : String(err)}` };
      })
      .then((outcome) => {
        if (controller.signal.aborted) return; // paused, restarted or superseded
        if (entry.controller === controller) entry.controller = null;
        const next = reduceAiOutcome(entry.core, jobId, outcome);
        this.opts.log?.('ai-result', {
          gameId,
          jobId,
          ok: outcome.ok,
          ms: this.now() - started,
          committed: next !== null,
          ...(outcome.ok ? { turnId: outcome.turnId, source: outcome.ai.source, matchedEngineBest: outcome.ai.matchedEngineBest } : { error: outcome.error }),
        });
        if (next) {
          entry.core = next;
          this.broadcast(entry);
        }
      });
  }
}
