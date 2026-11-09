import type { Command, CommandResponse, Snapshot } from '../../../shared/contracts/index.ts';

const json = { 'content-type': 'application/json' };

export async function createGame(): Promise<Snapshot> {
  const res = await fetch('/api/games', { method: 'POST', headers: json, body: '{}', credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Could not create a game (HTTP ${res.status}).`);
  return (await res.json()) as Snapshot;
}

export async function fetchGame(gameId: string): Promise<Snapshot | 'expired'> {
  const res = await fetch(`/api/games/${gameId}`, { credentials: 'same-origin' });
  if (res.status === 404 || res.status === 403) return 'expired';
  if (!res.ok) throw new Error(`Could not load the game (HTTP ${res.status}).`);
  return (await res.json()) as Snapshot;
}

export async function sendCommand(gameId: string, expectedVersion: number, command: Command): Promise<CommandResponse> {
  const res = await fetch(`/api/games/${gameId}/commands`, {
    method: 'POST',
    headers: json,
    credentials: 'same-origin',
    body: JSON.stringify({ commandId: crypto.randomUUID(), expectedVersion, command }),
  });
  return (await res.json()) as CommandResponse;
}

export async function fetchHealth(): Promise<{ jevReady: boolean; model: string } | null> {
  try {
    const res = await fetch('/api/health');
    return res.ok ? ((await res.json()) as { jevReady: boolean; model: string }) : null;
  } catch {
    return null;
  }
}

/**
 * Live snapshots over SSE, with a slow poll as a safety net for proxies that
 * buffer event streams. Returns an unsubscribe function.
 */
export function subscribe(
  gameId: string,
  onSnapshot: (s: Snapshot) => void,
  onExpired: () => void,
  onConnection: (live: boolean) => void,
): () => void {
  let closed = false;
  const source = new EventSource(`/api/games/${gameId}/events`, { withCredentials: true });
  source.addEventListener('snapshot', (e) => onSnapshot(JSON.parse((e as MessageEvent<string>).data) as Snapshot));
  source.onopen = () => onConnection(true);
  source.onerror = () => onConnection(false);

  const poll = async () => {
    if (closed) return;
    try {
      const s = await fetchGame(gameId);
      if (s === 'expired') {
        onExpired();
        return;
      }
      onSnapshot(s);
    } catch {
      /* transient; next poll will retry */
    }
  };
  const timer = window.setInterval(poll, 2500);
  return () => {
    closed = true;
    source.close();
    window.clearInterval(timer);
  };
}
