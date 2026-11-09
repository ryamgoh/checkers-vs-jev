import { useEffect, useRef, type ReactNode } from 'react';
import { useGame } from '../game/store.ts';
import { resultReason, resultTitle } from './status.ts';

function Dialog({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);
  return (
    <div className={`overlay ${className}`}>
      <div className="card" role="dialog" aria-modal="true" aria-label={label} ref={ref}>
        {children}
      </div>
    </div>
  );
}

export function Overlays() {
  const s = useGame((st) => st.snapshot);
  const animating = useGame((st) => (st.display?.queue.length ?? 0) > 0);
  const confirming = useGame((st) => st.confirmingRestart);
  const expired = useGame((st) => st.expired);
  const loading = useGame((st) => st.loading);
  const busy = useGame((st) => st.busy);
  const a = useGame.getState();

  if (expired) {
    return (
      <Dialog label="Session expired">
        <h2>Session expired</h2>
        <p>This game is no longer on the server. Start a new game to keep playing.</p>
        <button className="primary" onClick={() => void a.newGame()}>
          New game
        </button>
      </Dialog>
    );
  }
  if (!s) return loading ? <div className="overlay"><div className="card"><p>Setting up the board…</p></div></div> : null;

  if (confirming) {
    return (
      <Dialog label="Restart this game?">
        <h2>Restart this game?</h2>
        <p>The current game will be abandoned and a fresh game starts on your turn.</p>
        <div className="row">
          <button onClick={() => a.cancelRestart()}>Cancel</button>
          <button className="primary danger" onClick={() => void a.restart()}>
            Restart
          </button>
        </div>
      </Dialog>
    );
  }

  if (s.lifecycle === 'ready') {
    return (
      <Dialog label="Checkers vs Jev" className="ready">
        <h2 className="title">Checkers vs Jev</h2>
        <p>
          American checkers on an 8×8 board. <strong>You move first. Captures are mandatory.</strong>
        </p>
        <p className="muted small">
          Opponent: Jev ({s.config.model}) chooses every move, with the Marcher search engine's evaluation of each legal
          move as its input.
        </p>
        {!s.config.jevReady && <p className="error-detail">Jev is not configured on the server (missing OpenRouter key), so the game cannot start.</p>}
        <button className="primary big" disabled={busy || !s.config.jevReady} onClick={() => void a.start()}>
          Start game
        </button>
      </Dialog>
    );
  }

  if (s.lifecycle === 'paused') {
    return (
      <Dialog label="Game paused">
        <h2>Game paused</h2>
        <div className="row">
          <button className="primary" disabled={busy} onClick={() => void a.resume()}>
            Resume
          </button>
          <button disabled={busy} onClick={() => a.requestRestart()}>
            Restart
          </button>
        </div>
      </Dialog>
    );
  }

  if (s.lifecycle === 'finished' && !animating) {
    return (
      <Dialog label={resultTitle(s)} className="finished">
        <h2 className="title">{resultTitle(s)}</h2>
        <p>{resultReason(s)}</p>
        <button className="primary big" disabled={busy} onClick={() => void a.restart()}>
          Play again
        </button>
      </Dialog>
    );
  }
  return null;
}
