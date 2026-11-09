// Loads the vendored Marcher WebAssembly engine in Node.
// Plain JavaScript so it runs unchanged inside worker threads.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let factory = null;
let compiled = null;

async function init() {
  if (factory) return;
  // marcher.js is a classic (non-ESM) Emscripten script that assigns module.exports.
  const file = path.join(here, 'vendor', 'marcher.js');
  const source = fs.readFileSync(file, 'utf8');
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__dirname', '__filename', source)(
    require,
    mod,
    mod.exports,
    path.dirname(file),
    file,
  );
  factory = mod.exports;
  compiled = await WebAssembly.compile(fs.readFileSync(path.join(here, 'vendor', 'marcher.wasm')));
}

/**
 * A fresh engine instance (about 1 ms). Marcher keeps game history and its
 * transposition table in module globals, so a fresh instance per evaluation
 * keeps hypothetical positions from leaking into later searches.
 */
export async function createEngine() {
  await init();
  return factory({
    instantiateWasm(imports, done) {
      WebAssembly.instantiate(compiled, imports).then((instance) => done(instance, compiled));
      return {};
    },
  });
}

/** Search one position; `player` 1 = ivory, 2 = red (see coords.ts). */
export function search(engine, pos, seconds) {
  engine._wasm_search(pos.p1, pos.p2, pos.p1k, pos.p2k, pos.player, seconds, 64, -1);
  const ptr = engine._wasm_result_ptr() >> 2;
  const r = engine.HEAP32.subarray(ptr, ptr + engine._wasm_result_fields());
  return { eval: r[2], depth: r[3], nodes: (r[6] >>> 0) * 4294967296 + (r[5] >>> 0) };
}

export function perft(engine, pos, depth) {
  return engine._wasm_perft(pos.p1, pos.p2, pos.p1k, pos.p2k, pos.player, depth);
}
