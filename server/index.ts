import { loadConfig } from './config.ts';
import { MarcherProvider } from './ai/marcher/provider.ts';
import { createOpponent } from './ai/opponent.ts';
import { GameStore } from './game/store.ts';
import { buildApp } from './http/app.ts';
import { JevClient } from './integrations/jev.ts';

const config = loadConfig();
const log = (event: string, data: Record<string, unknown>) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...data }));

const jev = new JevClient({
  apiKey: config.openrouterApiKey,
  model: config.jevModel,
  timeoutMs: config.jevTimeoutMs,
  baseUrl: config.openrouterBaseUrl,
  maxCallsPerDay: config.jevMaxCallsPerDay,
});

const store = new GameStore({
  runAi: createOpponent({ engine: new MarcherProvider(), jev, engineBudgetMs: config.engineBudgetMs }),
  config: { model: config.jevModel, jevReady: jev.ready, engine: 'Marcher 1fa785e (WASM)' },
  ttlMs: config.gameTtlMs,
  log,
});

const app = await buildApp({
  store,
  staticDir: config.staticDir,
  health: () => ({ jevReady: jev.ready, model: config.jevModel, engine: 'marcher', games: store.size() }),
});

setInterval(() => {
  const removed = store.sweep();
  if (removed) log('sweep', { removed });
}, 60_000).unref();

await app.listen({ port: config.port, host: config.host });
log('listening', { port: config.port, jevReady: jev.ready, model: config.jevModel, static: config.staticDir });
