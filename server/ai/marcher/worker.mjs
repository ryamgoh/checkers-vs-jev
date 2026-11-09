// Worker thread: evaluates positions with Marcher. WASM search is synchronous,
// so the parent cancels by terminating this worker.
import { parentPort } from 'node:worker_threads';
import { createEngine, search } from './loader.mjs';

parentPort.on('message', async (msg) => {
  if (msg.type !== 'evaluate') return;
  try {
    const results = [];
    for (const pos of msg.positions) {
      const engine = await createEngine();
      results.push(search(engine, pos, msg.seconds));
    }
    parentPort.postMessage({ type: 'result', id: msg.id, results });
  } catch (err) {
    parentPort.postMessage({ type: 'error', id: msg.id, message: String((err && err.stack) || err) });
  }
});
