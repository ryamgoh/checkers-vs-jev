import { createEngine, perft } from '../../server/ai/marcher/loader.mjs';
import { toMarcher } from '../../server/ai/marcher/coords.ts';
import { applyLegalTurn, applyTurn, initialState, legalTurns, stepPerft, gameResult, type GameState } from '../../shared/rules/index.ts';

const engine = await createEngine();
const m = (s: GameState, d: number) => Number(perft(engine, toMarcher(s.board, s.sideToMove), d));
const o = (s: GameState, d: number) => stepPerft(s.board, s.sideToMove, d);
const show = (s: GameState) => {
  const rows: string[] = [];
  for (let r = 0; r < 8; r++) { let line = ''; for (let c = 0; c < 8; c++) { if ((r + c) % 2 === 0) { line += ' .'; continue; } const sq = r * 4 + Math.floor(c / 2) + 1; const p = s.board[sq - 1]; line += ' ' + (p ? (p.side === 'red' ? (p.king ? 'R' : 'r') : (p.king ? 'I' : 'i')) : '_'); } rows.push(line); }
  return rows.join('\n');
};
const history = process.argv[2]!.split(' ');
let s = initialState();
for (const id of history) s = applyTurn(s, id);
let d = 1; while (o(s, d) === m(s, d) && d < 6) d++;
console.log('min mismatch depth', d, 'ours', o(s, d), 'marcher', m(s, d));
// descend through complete turns whose step length k < d
for (let guard = 0; guard < 20 && d > 1; guard++) {
  let found = false;
  for (const t of legalTurns(s)) {
    const k = Math.max(1, t.captures.length);
    if (k >= d) continue;
    const child = applyLegalTurn(s, t);
    if (gameResult(child)?.reason === 'no-moves') continue;
    if (o(child, d - k) !== m(child, d - k)) { console.log(`descend via ${t.id} -> depth ${d - k}: ours ${o(child, d - k)} marcher ${m(child, d - k)}`); s = child; d = d - k; found = true; break; }
  }
  if (!found) break;
}
console.log('stuck at depth', d, 'side', s.sideToMove, '\n' + show(s));
console.log('our turns:', legalTurns(s).map((t) => t.id).join(' '));
for (let k = 1; k <= d; k++) console.log(`depth ${k}: ours ${o(s, k)} marcher ${m(s, k)}`);
