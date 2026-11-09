import { useEffect, useRef } from 'react';
import { pieceCounts } from '../../../shared/rules/state.ts';
import type { MoveRecord } from '../../../shared/contracts/index.ts';
import { useGame } from '../game/store.ts';
import { aiTag, statusLine } from './status.ts';

function Counts({ label, side, active }: { label: string; side: 'red' | 'ivory'; active: boolean }) {
  const board = useGame((s) => s.snapshot?.board);
  const c = board ? pieceCounts(board)[side] : { men: 12, kings: 0 };
  return (
    <div className={`player player-${side}${active ? ' active' : ''}`}>
      <span className={`chip chip-${side}`} aria-hidden="true" />
      <div>
        <div className="player-name">{label}</div>
        <div className="player-counts">
          {c.men} men · {c.kings} {c.kings === 1 ? 'king' : 'kings'}
        </div>
      </div>
    </div>
  );
}

function History({ moves }: { moves: readonly MoveRecord[] }) {
  const end = useRef<HTMLLIElement>(null);
  // Block body: newer browsers return a Promise from scrollIntoView, which React would treat as a cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [moves.length]);
  const rows: [MoveRecord, MoveRecord | undefined][] = [];
  for (let i = 0; i < moves.length; i += 2) rows.push([moves[i]!, moves[i + 1]]);
  if (rows.length === 0) return <p className="muted">No moves yet.</p>;
  return (
    <ol className="history" aria-label="Move history">
      {rows.map(([red, ivory], i) => (
        <li key={i} ref={i === rows.length - 1 ? end : undefined}>
          <span className="num">{i + 1}.</span>
          <span className="mv">{red.turn.id}</span>
          <span className="mv">
            {ivory?.turn.id ?? ''}
            {ivory && aiTag(ivory) && <span className={`tag tag-${aiTag(ivory)!.replace(' ', '-')}`}>{aiTag(ivory)}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function Panel() {
  const s = useGame((st) => st.snapshot);
  const animating = useGame((st) => st.display?.queue[0] ?? null);
  const message = useGame((st) => st.message);
  const busy = useGame((st) => st.busy);
  const live = useGame((st) => st.live);
  const actions = useGame.getState();
  const status = statusLine(s, animating);
  const humanTurn = s?.lifecycle === 'playing' && s.phase === 'human-input' && !animating;

  return (
    <aside className="panel" aria-label="Game controls and status">
      <header className="panel-head">
        <h1>Checkers vs Jev</h1>
        <p className="muted">American checkers · you play red and move first</p>
      </header>

      <section className="players">
        <Counts label="You" side="red" active={s?.lifecycle === 'playing' && s.sideToMove === 'red'} />
        <Counts label="Jev" side="ivory" active={s?.lifecycle === 'playing' && s.sideToMove === 'ivory'} />
      </section>

      <section className={`status status-${status.tone}`} aria-live="polite">
        {status.busy && <span className="spinner" aria-hidden="true" />}
        <span data-testid="status">{status.text}</span>
      </section>
      {s?.phase === 'ai-error' && s.aiError && <p className="error-detail">{s.aiError}</p>}
      <p className="message" role="status" aria-live="polite">
        {message ?? ''}
      </p>

      <section className="controls">
        {s?.lifecycle === 'ready' && (
          <button className="primary" disabled={busy || !s.config.jevReady} onClick={() => void actions.start()}>
            Start game
          </button>
        )}
        {s?.lifecycle === 'playing' && (
          <button disabled={busy} onClick={() => void actions.pause()}>
            Pause
          </button>
        )}
        {s?.lifecycle === 'paused' && (
          <button className="primary" disabled={busy} onClick={() => void actions.resume()}>
            Resume
          </button>
        )}
        {s?.phase === 'ai-error' && (
          <button className="primary" disabled={busy} onClick={() => void actions.retryAi()}>
            Retry
          </button>
        )}
        {(s?.lifecycle === 'playing' || s?.lifecycle === 'paused') && (
          <button disabled={busy} onClick={() => actions.requestRestart()}>
            Restart
          </button>
        )}
        {s?.lifecycle === 'finished' && (
          <button className="primary" disabled={busy} onClick={() => void actions.restart()}>
            Play again
          </button>
        )}
      </section>

      {humanTurn && s && (
        <section className="moves" aria-label="Your legal moves">
          <h2>Your moves</h2>
          <div className="move-buttons">
            {s.legalTurns.map((t) => (
              <button key={t.id} className={t.captures.length ? 'capture' : ''} disabled={busy} onClick={() => void actions.playTurn(t.id)}>
                {t.id}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="history-wrap">
        <h2>Moves</h2>
        <History moves={s?.moves ?? []} />
      </section>

      <footer className="panel-foot muted">
        Opponent: Jev ({s?.config.model ?? '…'}) · analyst: Marcher engine · {live ? 'live' : 'reconnecting'}
      </footer>
    </aside>
  );
}
