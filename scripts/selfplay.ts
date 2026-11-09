// Plays complete games against the live server: the "human" picks seeded-random legal moves,
// Jev answers every ivory move. Reports results, AI latency (p50/p95) and engine-match rate.
// Usage: npx tsx scripts/selfplay.ts [games=1] [baseUrl=http://localhost:3000] [seed=1]
import type { CommandResponse, Snapshot } from '../shared/contracts/index.ts';

const games = Number(process.argv[2] ?? 1);
const base = process.argv[3] ?? 'http://localhost:3000';
let seed = Number(process.argv[4] ?? 1);
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

async function playOne(n: number) {
  let cookie = '';
  const created = await fetch(`${base}/api/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  cookie = (created.headers.get('set-cookie') ?? '').split(';')[0]!;
  let s = (await created.json()) as Snapshot;
  const send = async (command: object) => {
    const res = await fetch(`${base}/api/games/${s.gameId}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ commandId: crypto.randomUUID(), expectedVersion: s.version, command }),
    });
    const body = (await res.json()) as CommandResponse;
    if (body.snapshot) s = body.snapshot;
    if (!body.ok) throw new Error(`${body.error}: ${body.message}`);
  };
  const refresh = async () => {
    s = (await (await fetch(`${base}/api/games/${s.gameId}`, { headers: { cookie } })).json()) as Snapshot;
  };

  await send({ type: 'start' });
  let retries = 0;
  while (s.lifecycle !== 'finished' && s.moves.length < 300) {
    if (s.phase === 'human-input') {
      const t = s.legalTurns[Math.floor(rand() * s.legalTurns.length)]!;
      await send({ type: 'move', turnId: t.id });
    } else if (s.phase === 'ai-error') {
      console.log(`  game ${n}: ai-error "${s.aiError}" — retrying`);
      if (++retries > 3) throw new Error('too many AI errors');
      await send({ type: 'retry-ai' });
    } else {
      await new Promise((r) => setTimeout(r, 150));
      await refresh();
    }
  }
  const ai = s.moves.filter((m) => m.ai);
  return { result: s.result, plies: s.moves.length, ai, retries };
}

const all: number[] = [];
let matched = 0;
let analyzed = 0;
let forced = 0;
for (let g = 1; g <= games; g++) {
  const t0 = Date.now();
  const { result, plies, ai, retries } = await playOne(g);
  for (const m of ai) {
    if (m.ai!.source === 'forced') {
      forced++;
      continue;
    }
    all.push(m.ai!.ms);
    if (m.ai!.matchedEngineBest !== null) {
      analyzed++;
      if (m.ai!.matchedEngineBest) matched++;
    }
  }
  console.log(`game ${g}: ${result?.winner ?? 'draw'} by ${result?.reason} after ${plies} plies, ${ai.length} AI moves, ${retries} retries, ${Math.round((Date.now() - t0) / 1000)} s`);
}
all.sort((a, b) => a - b);
const pct = (p: number) => all[Math.min(all.length - 1, Math.floor(p * all.length))] ?? 0;
console.log(`AI decisions (non-forced): ${all.length}; forced: ${forced}`);
console.log(`latency ms: p50 ${pct(0.5)}, p95 ${pct(0.95)}, max ${all[all.length - 1]}`);
console.log(`Jev matched the engine's top score: ${matched}/${analyzed}`);
