import { create } from 'zustand';
import type { Command, MoveRecord, Snapshot } from '../../../shared/contracts/index.ts';
import { createGame, fetchGame, sendCommand, subscribe } from '../net/api.ts';
import { clickSquare, type Selection } from './selection.ts';
import { displayKey, enqueueOptimistic, finishAnimation, resetDisplay, syncDisplay, type Display } from './display.ts';

const SESSION_KEY = 'cvj:gameId';

interface GameUi {
  snapshot: Snapshot | null;
  display: Display | null;
  selection: Selection | null;
  message: string | null;
  expired: boolean;
  loading: boolean;
  live: boolean;
  busy: boolean;
  confirmingRestart: boolean;
  reducedMotion: boolean;

  init(): Promise<void>;
  newGame(): Promise<void>;
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  requestRestart(): void;
  cancelRestart(): void;
  restart(): Promise<void>;
  retryAi(): Promise<void>;
  clickSquare(square: number): void;
  playTurn(turnId: string): Promise<void>;
  animationDone(): void;
  setMessage(message: string | null): void;
}

let unsubscribe: (() => void) | null = null;
let messageTimer: number | undefined;

export const useGame = create<GameUi>((set, get) => {
  const receive = (s: Snapshot) => {
    const current = get().snapshot;
    // Ignore out-of-order snapshots of the same game generation.
    if (current && displayKey(current) === displayKey(s) && s.version < current.version) return;
    const display = syncDisplay(get().display, s);
    const sameGame = current !== null && displayKey(current) === displayKey(s);
    set({ snapshot: s, display, selection: sameGame ? get().selection : null, expired: false });
  };

  const attach = (s: Snapshot) => {
    unsubscribe?.();
    sessionStorage.setItem(SESSION_KEY, s.gameId);
    set({ display: resetDisplay(s), snapshot: s, selection: null });
    unsubscribe = subscribe(
      s.gameId,
      receive,
      () => set({ expired: true }),
      (live) => set({ live }),
    );
  };

  const flash = (message: string) => {
    set({ message });
    window.clearTimeout(messageTimer);
    messageTimer = window.setTimeout(() => set({ message: null }), 3200);
  };

  /** Sends a command; for control commands, retries once on a stale version (the intent is unambiguous). */
  const command = async (cmd: Command, retryOnStale: boolean) => {
    const s = get().snapshot;
    if (!s) return;
    set({ busy: true });
    try {
      let res = await sendCommand(s.gameId, s.version, cmd);
      if (!res.ok && res.error === 'stale' && res.snapshot && retryOnStale) {
        receive(res.snapshot);
        res = await sendCommand(s.gameId, res.snapshot.version, cmd);
      }
      if (res.ok) receive(res.snapshot);
      else {
        if (res.snapshot) receive(res.snapshot);
        if (res.error === 'not-found') set({ expired: true });
        else flash(res.message);
      }
    } catch {
      flash('Connection problem — please try again.');
    } finally {
      set({ busy: false });
    }
  };

  return {
    snapshot: null,
    display: null,
    selection: null,
    message: null,
    expired: false,
    loading: true,
    live: false,
    busy: false,
    confirmingRestart: false,
    reducedMotion: typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,

    async init() {
      set({ loading: true });
      try {
        const saved = sessionStorage.getItem(SESSION_KEY);
        const existing = saved ? await fetchGame(saved) : 'expired';
        attach(existing === 'expired' ? await createGame() : existing);
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Could not reach the game server.');
      } finally {
        set({ loading: false });
      }
    },

    async newGame() {
      set({ loading: true, expired: false });
      try {
        attach(await createGame());
      } finally {
        set({ loading: false });
      }
    },

    start: () => command({ type: 'start' }, false),
    pause: () => command({ type: 'pause' }, true),
    resume: () => command({ type: 'resume' }, true),
    retryAi: () => command({ type: 'retry-ai' }, true),
    requestRestart: () => set({ confirmingRestart: true }),
    cancelRestart: () => set({ confirmingRestart: false }),
    async restart() {
      set({ confirmingRestart: false, selection: null });
      await command({ type: 'restart' }, true);
    },

    clickSquare(square) {
      const { snapshot: s, display, busy, selection } = get();
      if (!s || !display) return;
      if (s.lifecycle !== 'playing' || s.phase !== 'human-input' || display.queue.length > 0 || busy) {
        if (s.lifecycle === 'playing' && s.phase !== 'human-input') flash('Wait for Jev to finish its move.');
        return;
      }
      const result = clickSquare(s.legalTurns, s.board, selection, square);
      if (result.kind === 'select') set({ selection: result.selection, message: null });
      else if (result.kind === 'invalid') {
        set({ selection: result.selection });
        flash(result.message);
      } else void get().playTurn(result.turnId);
    },

    async playTurn(turnId) {
      const { snapshot: s, display } = get();
      if (!s || !display) return;
      const turn = s.legalTurns.find((t) => t.id === turnId);
      if (!turn) return;
      const record: MoveRecord = { ply: s.moves.length + 1, side: 'red', turn, ai: null };
      set({ display: enqueueOptimistic(display, record), selection: null, message: null });
      await command({ type: 'move', turnId }, false);
    },

    animationDone() {
      const { display, snapshot } = get();
      if (!display) return;
      let next = finishAnimation(display);
      if (next.queue.length === 0 && snapshot) next = syncDisplay(next, snapshot);
      set({ display: next });
    },

    setMessage: (message) => set({ message }),
  };
});
