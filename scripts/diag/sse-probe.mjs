// Plays a few moves against a deployed server while holding the SSE stream open, like the browser client does.
// Usage: node scripts/diag/sse-probe.mjs https://host [moves]
const base = process.argv[2] ?? 'http://localhost:3000';
const plies = Number(process.argv[3] ?? 3);
const origin = new URL(base).origin;
let cookie = '';
const headers = () => ({ 'content-type': 'application/json', origin, 'sec-fetch-site': 'same-origin', cookie });

async function post(path, body) {
  const res = await fetch(base + path, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return res.json();
}

const created = await post('/api/games', {});
const gameId = created.gameId;
let latest = created;
const waiters = [];
const ctrl = new AbortController();
const stream = await fetch(`${base}/api/games/${gameId}/events`, { headers: { cookie, accept: 'text/event-stream' }, signal: ctrl.signal });
(async () => {
  const dec = new TextDecoder();
  let buf = '';
  try {
    for await (const chunk of stream.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('');
        if (!data) continue;
        try {
          const snap = JSON.parse(data);
          if (snap.version >= latest.version) latest = snap;
          waiters.splice(0).forEach((w) => w());
        } catch { /* keep-alive or non-JSON */ }
      }
    }
  } catch { /* aborted */ }
})();

const until = async (pred, ms = 30000) => {
  const t0 = Date.now();
  while (!pred(latest)) {
    if (Date.now() - t0 > ms) throw new Error(`timeout in phase ${latest.phase}`);
    await new Promise((r) => { waiters.push(r); setTimeout(r, 500); });
  }
};

let n = 0;
const send = (command) => post(`/api/games/${gameId}/commands`, { commandId: `probe${String(++n).padStart(4, '0')}`, expectedVersion: latest.version, command });
latest = (await send({ type: 'start' })).snapshot;
for (let p = 0; p < plies; p++) {
  await until((s) => s.phase === 'human-input' || s.phase === 'finished');
  if (latest.phase === 'finished') break;
  const legal = latest.legalTurns ?? latest.legalMoves ?? [];
  const pick = legal[Math.floor(legal.length / 2)];
  const turnId = pick?.id ?? pick?.turnId ?? pick;
  const t0 = Date.now();
  const r = await send({ type: 'move', turnId });
  if (r.snapshot) latest = r.snapshot;
  await until((s) => s.phase !== 'ai-thinking' && s.moves.length >= r.snapshot.moves.length + 1);
  const ai = latest.moves.at(-1).ai ?? {};
  console.log(`you ${turnId} -> jev ${latest.moves.at(-1).turn?.id} in ${Date.now() - t0} ms; provenance=${ai.provenance} engineBest=${ai.engineBest} matched=${ai.matchedEngineBest} serverMs=${ai.ms ?? '-'}`);
}
ctrl.abort();
