# Checkers vs Jev Implementation Plan

> **For agentic workers:** Execute this plan task by task, either subagent-driven (a fresh implementer and reviewer per task) or natively in one session with a whole-branch review at the end. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser checkers game in which you play red against a Jev-backed, engine-strength opponent on a Three.js board, with Start, Pause/Resume and Restart (including after the game ends).

**Architecture:** A Node server owns the authoritative game state, validates every move with a perft-verified rules core, and runs the opponent. Jev is the engine: it chooses every AI move from all legal turns through the OpenRouter Decisions API, and Marcher (WASM, in a worker thread) acts as its analyst by attaching an evaluation to each turn. The React/Three.js client renders snapshots streamed over server-sent events and submits versioned commands, so Pause and Restart can never race with an in-flight AI move.

**Tech Stack:** TypeScript 5 (strict), Node 22, pnpm; React 19, Vite 8, three 0.187, @react-three/fiber 9, @react-three/drei 10, @react-spring/three 10, Zustand 5; Fastify 5, XState 5, Zod 4; rapid-draughts 1.0.6 (rules), Marcher WASM at commit `1fa785e` (engine); OpenRouter Decisions API with `typesafe/jev-1.14`; Vitest 5, fast-check 4, Playwright 1.65.

**Spec:** [`SPEC.md`](../../SPEC.md), with the evaluation and amendment proposal in [`BUILD-EVALUATION.md`](../../BUILD-EVALUATION.md). The spec was amended on 9 November 2026 (Decisions section): Jev chooses every move from all legal turns, informed by Marcher's evaluations; hosting starts on the temporary Manus cloud sandbox.

## Global Constraints

- Rules: WCDF American/English 8×8 checkers; mandatory captures; free choice among capture routes; multi-jumps finish with the same piece; short kings; promotion ends the turn; no legal move on your turn is a loss.
- Sides: you play `red`, which moves first; the AI plays `ivory`. No side selection in v1.
- Draws are automatic: third occurrence of the same position (board + side to move) at a turn boundary, or 40 completed turns **per side** with no capture and no man advance.
- Board squares use standard 1–32 numbering; red starts on squares 1–12, ivory on 21–32.
- `OPENROUTER_API_KEY` is read only by the server at runtime; it never appears in client bundles, responses, logs or the repository.
- Jev: `POST https://openrouter.ai/api/alpha/decisions`, `model: "typesafe/jev-1.14"` (pinned, never `~typesafe/jev-latest`), 5,000 ms timeout, at most one retry for 429/5xx/network errors, no retry for 401/402/403.
- Every AI move is chosen by Jev from all legal turns (except a single forced turn) and must be a member of the current position's legal turns before it is committed. Jev's legal choice is final; the engine never overrides it.
- If Jev fails after one retry or returns an unknown ID, the AI does not move: phase `ai-error` with Retry. Never substitute a non-Jev move.
- AI moves are labeled by provenance: `searched` in Phases 1–2; `exact` only from a verified endgame database in Phase 3. Never display "optimal" or "proven" for a searched move.
- Performance: selection feedback ≤ 100 ms; AI decision ≤ 5 s at the 95th percentile; board ≈ 60 fps on a modern laptop.
- Coverage: ≥ 95% branch coverage for `shared/rules/` and `server/game/`.

## Review Focus

- **Double clicks and clicks during the AI's turn** (Start, Restart, a board square): exactly one game and one AI job exist; extra commands get a version conflict, not a second game. Test in Task 4.
- **Pause landing at the same moment as the AI's move:** the move is either fully committed before the pause or discarded; the board never shows half a turn. Test in Task 7.
- **Multi-jump branches that share a first landing, and promotion mid-capture:** selection stays ambiguous until a distinguishing landing is chosen, and reaching the king row ends the turn. Tests in Tasks 1 and 9.
- **Refresh or network drop mid-game:** the client reconnects to the same game at the current version without replaying commands. Test in Task 10.
- **Jev slow, refusing, or returning an unknown move:** no substitute move is played; the game shows "Jev unavailable" with Retry, and Retry resumes cleanly. Tests in Task 7.

---

## File Structure

```text
package.json, pnpm-lock.yaml, tsconfig.json, vite.config.ts, vitest.config.ts, playwright.config.ts
shared/rules/types.ts            Side, Piece, Board, Turn, GameState, GameResult
shared/rules/rapid-adapter.ts    Board <-> rapid-draughts conversion (internal only)
shared/rules/turns.ts            initialState, legalTurns, applyTurn, turnId, IllegalTurnError
shared/rules/adjudicate.ts       positionKey, gameResult (no-moves, repetition, forty-move)
shared/rules/perft.ts            turnPerft, stepPerft
shared/contracts/schemas.ts      Zod schemas: Command, Snapshot, ServerEvent
server/index.ts                  Fastify bootstrap, static client, /api/health
server/game/machine.ts           XState lifecycle machine
server/game/store.ts             GameStore: create, get, dispatch, subscribe
server/http/routes.ts            REST commands + SSE stream
server/ai/engine-provider.ts     EngineProvider interface + RankedTurns type
server/ai/marcher/coords.ts      1–32 squares <-> Marcher 0–63 bitboards
server/ai/marcher/worker.ts      worker_threads entry hosting the WASM module
server/ai/marcher/provider.ts    MarcherProvider implements EngineProvider
server/ai/marcher/vendor/        marcher.js, marcher.wasm, LICENSE, SHA256SUMS
server/ai/opponent.ts            runAiTurn: engine -> Jev -> validated decision
server/integrations/jev.ts       chooseTurn: Decisions API client
server/security/                 owner gate, CSRF check, rate limit, spend ceiling (Task 12)
client/src/main.tsx, App.tsx     Entry and screen routing by lifecycle
client/src/net/api.ts, sse.ts    Command client and snapshot stream
client/src/game/store.ts         Zustand store: snapshot + selection
client/src/game/selection.ts     selectionReducer for click-to-move and multi-jumps
client/src/scene/coords.ts       squareToWorld, worldToSquare
client/src/scene/Board.tsx, Pieces.tsx, Markers.tsx, BoardScene.tsx
client/src/ui/ReadyScreen.tsx, HUD.tsx, PausedOverlay.tsx, FinishedOverlay.tsx, RestartDialog.tsx, MoveList.tsx
tests/unit/, tests/integration/, tests/e2e/   As named per task below
```

---

### Task 0: Lock decisions and amend the spec

**Files:**
- Modify: `SPEC.md` Section 2 (optimality), Section 6 (Jev skipped on forced moves), Section 10 criterion 4

**Interfaces:**
- Produces: the approved definition of "optimal" that Tasks 6–7 implement.

- [x] **Step 1: Record the answers** at the top of `SPEC.md` under "Decisions (9 November 2026)". Done.
- [x] **Step 2: Amend Sections 2, 5, 6, 7, 8 and 10**: Jev chooses every move from all legal turns annotated with Marcher's evaluations; no silent substitute on Jev failure; `searched` labels. Done.
- [ ] **Step 3: Commit**

```bash
git add SPEC.md && git commit -m "docs: amend optimal-play definition per approved decisions"
```

---

### Task 1: Scaffold and rules core

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `shared/rules/types.ts`, `shared/rules/rapid-adapter.ts`, `shared/rules/turns.ts`, `shared/rules/perft.ts`
- Test: `tests/unit/rules/turns.test.ts`, `tests/unit/rules/perft.test.ts`

**Interfaces:**
- Produces:
  - `type Side = 'red' | 'ivory'`; `type Square = number` (1–32); `type Piece = { side: Side; king: boolean }`; `type Board = ReadonlyArray<Piece | null>` (length 32, index = square − 1)
  - `type Turn = { id: string; from: Square; landings: Square[]; captures: Square[]; promotes: boolean }`. `id` is PDN-style: `"11-15"` for a move, `"15x24x31"` for jumps (origin plus every landing).
  - `type GameState = { board: Board; sideToMove: Side; ply: number; history: string[]; positionCounts: Record<string, number>; quietTurns: Record<Side, number> }`
  - `initialState(): GameState`; `legalTurns(state: GameState): Turn[]`; `applyTurn(state: GameState, turnId: string): GameState` (throws `IllegalTurnError`); `boardFromDiagram(rows: string[], sideToMove: Side): GameState` for tests
  - `turnPerft(state: GameState, depth: number): number`; `stepPerft(state: GameState, depth: number): number` (each jump step is one ply; same side continues mid-jump, matching Marcher)

- [ ] **Step 1: Scaffold.** `pnpm init`; add the Tech Stack dependencies at the versions above; scripts `dev`, `typecheck` (`tsc --noEmit`), `lint`, `test` (`vitest`), `test:integration`, `e2e` (`playwright test`), `build`, `start`. Enable `strict`.
- [ ] **Step 2: Write the failing tests**

```ts
// tests/unit/rules/perft.test.ts
const REFERENCE = [7, 49, 302, 1469, 7361, 36768, 179740, 845931];
test.each(REFERENCE.map((n, i) => [i + 1, n]))('turnPerft(%i) = %i from the start', (d, n) => {
  expect(turnPerft(initialState(), d)).toBe(n);
});

// tests/unit/rules/turns.test.ts
test('red moves first with 7 opening turns', () => {
  const s = initialState();
  expect(s.sideToMove).toBe('red');
  expect(legalTurns(s).map((t) => t.id).sort()).toEqual(['10-14','10-15','11-15','11-16','12-16','9-13','9-14']);
});
test('capture is mandatory: only jumps are legal when any jump exists', ...);   // fixture with one jump + quiet moves
test('free choice between a 1-capture and a 2-capture route', ...);             // both ids present
test('men cannot capture backwards; kings can', ...);
test('promotion ends the turn even if a further jump exists', ...);             // promotes === true, landings.length === 1
test('two routes sharing a first landing produce two distinct ids', ...);
test('applyTurn rejects an id not in legalTurns', () => {
  expect(() => applyTurn(initialState(), '1-5')).toThrow(IllegalTurnError);
});
```

- [ ] **Step 3: Run tests to verify they fail.** Run `pnpm test tests/unit/rules`. Expected: FAIL, modules not found.
- [ ] **Step 4: Implement.** Wrap `EnglishDraughtsEngineFactory.setup({ player, board, stats: { sinceCapture: 0, sinceNonKingAdvance: 0 } })` in `rapid-adapter.ts`, always resetting stats so the library's own draw rule never triggers. Use only its `moves`. Reconstruct `landings` from `origin`, `destination` and `captures`: from the current square, the next landing is the square beyond an adjacent captured piece, searched depth-first until all captures are consumed. Verify the library's 0–31 index mapping to squares 1–32 with the opening-moves test, not by assumption.
- [ ] **Step 5: Run tests to verify they pass.** Run `pnpm test tests/unit/rules`. Expected: PASS, including perft depth 8 = 845,931.
- [ ] **Step 6: Commit** — `git commit -m "feat(rules): perft-verified English checkers turns"`

---

### Task 2: Draw adjudication and results

**Files:**
- Create: `shared/rules/adjudicate.ts`; Modify: `shared/rules/turns.ts` (update counters in `applyTurn`)
- Test: `tests/unit/rules/adjudicate.test.ts`

**Interfaces:**
- Consumes: `GameState`, `applyTurn`, `legalTurns` from Task 1.
- Produces: `type GameResult = { winner: Side | null; reason: 'no-moves' | 'repetition' | 'forty-move' }`; `positionKey(state: GameState): string`; `gameResult(state: GameState): GameResult | null`.

- [ ] **Step 1: Write the failing tests**

```ts
test('side to move with no pieces loses', ...);          // { winner: 'red', reason: 'no-moves' }
test('side to move fully blocked loses (not a draw)', ...);
test('third occurrence of a position is a draw', ...);    // kings shuffle back and forth; draw on the 3rd, not the 2nd
test('same board with a different side to move is a different position', ...);
test('40 quiet turns per side is a draw; 39 + 40 is not', ...);   // 79 quiet plies -> null, 80 -> forty-move
test('a capture resets both quiet counters', ...);
test('a man advance resets both quiet counters; a king move does not', ...);
test('no-moves loss is checked before draw rules', ...);
```

- [ ] **Step 2: Run** `pnpm test tests/unit/rules/adjudicate.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `positionKey` encodes all 32 squares plus side to move. `applyTurn` increments `positionCounts[key]` after each completed turn and updates `quietTurns`. `gameResult` returns a no-moves result first, then repetition when the count reaches 3, then forty-move when both sides reach 40.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then run `pnpm test --coverage shared/rules`; expected ≥ 95% branches.
- [ ] **Step 5: Commit** — `git commit -m "feat(rules): automatic draw adjudication"`

---

### Task 3: Shared contracts

**Files:**
- Create: `shared/contracts/schemas.ts`; Test: `tests/unit/contracts.test.ts`

**Interfaces:**
- Produces (Zod schemas and inferred types):
  - `Lifecycle = 'ready' | 'playing' | 'paused' | 'finished'`; `Phase = 'human-input' | 'ai-thinking' | 'ai-error' | null`
  - `Command = { commandId: uuid; expectedVersion: int } & ({ type: 'start' | 'pause' | 'resume' | 'restart' | 'retry-ai' } | { type: 'move'; turnId: string })`
  - `AiMove = { turnId: string; source: 'jev' | 'forced'; provenance: 'searched' | 'unanalyzed' | 'exact'; matchedEngineBest: boolean | null; score: number | null; depth: number | null; confidence: number | null }`
  - `Snapshot = { gameId; generation: int; version: int; lifecycle; phase; board; sideToMove; legalTurns: Turn[] /* empty unless human-input */; history: string[]; result: GameResult | null; lastAiMove: AiMove | null; aiStatus: string }`
  - `ServerEvent = { type: 'snapshot'; snapshot: Snapshot }`

- [ ] **Step 1: Write failing tests:** a `move` command without `turnId` fails to parse; an unknown `type` fails; a valid snapshot round-trips through `Snapshot.parse(JSON.parse(JSON.stringify(s)))`.
- [ ] **Step 2: Run** `pnpm test tests/unit/contracts.test.ts`. Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(contracts): command and snapshot schemas"`

---

### Task 4: Server lifecycle and game store

**Files:**
- Create: `server/game/machine.ts`, `server/game/store.ts`; Test: `tests/unit/game/store.test.ts`

**Interfaces:**
- Consumes: rules (Tasks 1–2), contracts (Task 3).
- Produces:
  - `class GameStore { create(ownerId: string): Snapshot; snapshot(gameId: string): Snapshot; dispatch(gameId: string, cmd: Command): DispatchResult; subscribe(gameId: string, fn: (s: Snapshot) => void): () => void; commitAiMove(gameId: string, generation: int, version: int, move: AiMove): boolean }`
  - `type DispatchResult = { ok: true; snapshot: Snapshot } | { ok: false; error: 'version-conflict' | 'invalid-command' | 'illegal-turn' | 'not-found'; snapshot: Snapshot }`
  - Event hook `onAiTurnNeeded(gameId, generation, version)`, consumed by Task 7.

- [ ] **Step 1: Write failing tests**

```ts
test('create returns ready, version 0, no AI job');
test('start moves ready -> playing/human-input and bumps version');
test('start twice with the same expectedVersion: second gets version-conflict, one game');
test('same commandId replayed returns the original result without a second transition');
test('legal human move -> playing/ai-thinking and fires onAiTurnNeeded once');
test('move while ai-thinking is rejected as invalid-command');
test('pause from ai-thinking -> paused; commitAiMove with the pre-pause version returns false');
test('resume from a paused AI turn fires onAiTurnNeeded exactly once with the new version');
test('restart increments generation, resets board/history/counters, lands in playing/human-input');
test('commitAiMove from an older generation returns false and leaves the board unchanged');
test('a result after any move -> finished; pause/resume rejected; restart (Play again) accepted');
```

- [ ] **Step 2: Run** `pnpm test tests/unit/game`. Expected: FAIL.
- [ ] **Step 3: Implement.** The XState machine owns allowed transitions. The store serializes dispatches per game, enforces `expectedVersion`, keeps the last 50 `commandId` results for idempotency, and increments `version` on every state change and `generation` on every restart. `commitAiMove` accepts only if generation, version, lifecycle `playing`, phase `ai-thinking`, and legal-turn membership all match.
- [ ] **Step 4: Run.** Expected: PASS; `server/game` branch coverage ≥ 95%.
- [ ] **Step 5: Commit** — `git commit -m "feat(server): race-safe game lifecycle store"`

---

### Task 5: HTTP API and live updates

**Files:**
- Create: `server/index.ts`, `server/http/routes.ts`; Test: `tests/integration/http.test.ts`

**Interfaces:**
- Consumes: `GameStore` (Task 4), schemas (Task 3).
- Produces: `POST /api/games` → `Snapshot`; `GET /api/games/:id` → `Snapshot`; `POST /api/games/:id/commands` (body `Command`) → `200 Snapshot` or `409 { error, snapshot }`; `GET /api/games/:id/events` → SSE stream of `ServerEvent`, first event is the current snapshot; `GET /api/health` → `200 { ok: true }`. `buildServer(deps): FastifyInstance` for tests.

- [ ] **Step 1: Write failing tests** using `app.inject`: create → 200 with lifecycle `ready`; invalid body → 400 with no stack trace; stale version → 409 including the current snapshot; SSE first event equals `GET` snapshot; a successful command pushes a new SSE event with `version + 1`.
- [ ] **Step 2: Run** `pnpm test:integration tests/integration/http.test.ts`. Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(server): command API and SSE snapshots"`

---

### Task 6: Engine worker (Marcher WASM)

**Files:**
- Create: `server/ai/engine-provider.ts`, `server/ai/marcher/coords.ts`, `server/ai/marcher/worker.ts`, `server/ai/marcher/provider.ts`, `server/ai/marcher/vendor/{marcher.js,marcher.wasm,LICENSE,SHA256SUMS}`, `scripts/fetch-marcher.mjs`
- Test: `tests/integration/marcher.test.ts`

**Interfaces:**
- Consumes: `GameState`, `legalTurns`, `applyTurn`, `stepPerft` (Task 1).
- Produces:
  - `interface EngineProvider { rankTurns(state: GameState, opts: { budgetMs: number; signal: AbortSignal }): Promise<RankedTurns> }`
  - `type RankedTurns = { best: string; candidates: { turnId: string; score: number; depth: number }[]; provenance: 'searched' | 'exact' }` covering every legal turn, sorted best-first, with `candidates[0].turnId === best`
  - `class MarcherProvider implements EngineProvider` — one worker per game; `dispose(gameId)`.

- [ ] **Step 1: Vendor the engine.** `scripts/fetch-marcher.mjs` downloads `marcher.js` and `marcher.wasm` from the Marcher GUI's published build and fails unless SHA-256 matches `SHA256SUMS`: `1833036c…a36500` (`marcher.js`) and `21b44a3b…33ce42` (`marcher.wasm`), the artifacts measured in the spike. Copy Marcher's MIT `LICENSE`. Append `module.exports = createMarcher;` when loading through `createRequire`, as the spike did.
- [ ] **Step 2: Write failing tests**

```ts
test('mapping: Marcher perft(1) = 7 and perft(6) = 36768 from our start position');
test('step-level rules agree: stepPerft(s, 6) === marcher perft(s, 6) on 200 random reachable positions');
test('every returned best is in legalTurns over 300 random positions, including mid-game multi-jumps');
test('a returned multi-jump is assembled into one complete Turn via forced_pos continuation');
test('candidates hold every legal turn with a score, sorted best first');
test('budgetMs 1000 returns within 1,500 ms');
test('abort() terminates the worker within 100 ms and rejects with AbortError; next call starts a fresh worker');
test('single legal turn returns it without searching');
```

- [ ] **Step 3: Run** `pnpm test:integration tests/integration/marcher.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement.** `coords.ts` maps square n to Marcher's 0–63 index and our `red` to the Marcher player whose men occupy rows 5–7 (verified by the mapping test). `rankTurns` runs one main search with 60% of the budget to get the best first step, completes multi-jumps by searching the intermediate position with `forced_pos`, then scores each other legal turn by searching the child position for the opponent with the remaining budget split evenly and negating the score. Treat scores with absolute value ≥ 2000 (Marcher's `WIN_MIN`) as search-found wins in the logs, still with provenance `searched`. Cancel with `worker.terminate()`, because WASM search is synchronous.
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit** — `git commit -m "feat(ai): Marcher WASM engine provider"`

---

### Task 7: Jev client and opponent runtime

**Files:**
- Create: `server/integrations/jev.ts`, `server/ai/opponent.ts`; Modify: `server/index.ts` (wire `onAiTurnNeeded` → `runAiTurn` → `commitAiMove`)
- Test: `tests/unit/ai/jev.test.ts`, `tests/integration/opponent.test.ts`

**Interfaces:**
- Consumes: `EngineProvider` (Task 6), `GameStore.commitAiMove` (Task 4).
- Produces:
  - `chooseTurn(input: { state: GameState; turns: Turn[]; ranking: RankedTurns | null }, opts: { signal: AbortSignal; fetchImpl?: typeof fetch }): Promise<{ kind: 'choice'; turnId: string; confidence?: number } | { kind: 'refusal' } | { kind: 'error'; retryable: boolean; status?: number }>`
  - `runAiTurn(state: GameState, deps: { engine: EngineProvider; jev: typeof chooseTurn; budgetMs: number; signal: AbortSignal }): Promise<AiMove>`

The request body, using only documented fields:

```json
{
  "model": "typesafe/jev-1.14",
  "state": { "side": "ivory", "board": "<8 text rows>", "history": ["11-15", "..."],
             "candidates": [{ "id": "22x15", "captures": 1, "promotes": false, "engineScore": 0 }] },
  "questions": { "move": { "type": "choice",
    "instructions": "You are playing ivory. Choose the strongest legal move. A search engine has evaluated every legal move; prefer the best evaluation, take forced wins, and never choose a losing move when a drawing or winning move exists.",
    "criteria": { "22x15": { "move": "Jump from 22 to 15, capturing 18", "engine": "best, score 0 (balanced)" },
                  "23-19": { "move": "Move from 23 to 19", "engine": "score -150 (worse by 1.5 men)" } } } }
}
```

- [ ] **Step 1: Write failing tests** with a fake `fetchImpl`:

```ts
test('request has pinned model, choice question, criteria keys === candidate ids, and no key in the body');
test('choice answer returns { kind: "choice", turnId }');
test('refusal answer returns { kind: "refusal" }');
test('401 -> error, not retried; 429 -> retried once then error');
test('timeout after 5000 ms -> error retryable');
test('runAiTurn: criteria keys are every legal turn id, each annotated with its engine evaluation');
test('runAiTurn: Jev picks the engine best -> source "jev", matchedEngineBest true');
test('runAiTurn: Jev picks a legal non-best turn -> committed as chosen, matchedEngineBest false');
test('runAiTurn: Jev returns an id outside the legal turns -> no move, phase "ai-error"');
test('runAiTurn: Jev refusal or error after one retry -> no move, phase "ai-error"; retry-ai then succeeds');
test('runAiTurn: engine failure -> Jev still chooses from unannotated legal turns, provenance "unanalyzed"');
test('runAiTurn: one legal turn -> no Jev call, source "forced"');
test('pause during engine search -> no commit; the board is unchanged');
test('pause after Jev answers but before commit -> commitAiMove returns false; the board is unchanged');
```

- [ ] **Step 2: Run** `pnpm test tests/unit/ai && pnpm test:integration tests/integration/opponent.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Every legal turn goes to Jev with its evaluation, translated into words relative to the best score ("best", "equal to best", "worse by about N men", "forced loss found"). The server re-checks the chosen ID against the legal turns. Pause and restart call `abort()` on the job's `AbortController`; `commitAiMove`'s generation/version check is the final guard.
- [ ] **Step 4: Run.** Expected: PASS. Run one opt-in live contract test with `JEV_LIVE=1 pnpm test:integration tests/integration/jev.live.test.ts` and confirm a `choice` answer whose ID is among the criteria keys.
- [ ] **Step 5: Commit** — `git commit -m "feat(ai): Jev-selected opponent with engine fallback"`

---

### Task 8: Three.js board scene

**Files:**
- Create: `client/src/scene/coords.ts`, `Board.tsx`, `Pieces.tsx`, `Markers.tsx`, `BoardScene.tsx`
- Test: `tests/unit/scene/coords.test.ts`

**Interfaces:**
- Produces: `squareToWorld(sq: Square): [x: number, z: number]`; `worldToSquare(x: number, z: number): Square | null`; `<BoardScene board={Board} selectable={Square[]} targets={{ sq: Square; kind: 'move' | 'capture' }[]} selected={Square | null} lastMove={Turn | null} onSquare={(sq) => void} reducedMotion={boolean} />`.

- [ ] **Step 1: Write failing tests:** squares 1–32 map to distinct dark-square centers; `worldToSquare(...squareToWorld(n)) === n` for every n; light squares map to `null`; square 1 sits on ivory's far side of the camera.
- [ ] **Step 2: Run** `pnpm test tests/unit/scene`. Expected: FAIL. **Step 3: Implement.** Use procedural geometry: board slab and 64 tiles, `LatheGeometry` pieces, a torus crown for kings, and an outline for selection. Legal targets use a ring; captures use a diamond, so they do not rely on color. Render with a fixed elevated camera and `@react-spring/three` slides (≈ 250 ms per step) and capture hops. Use drei `ContactShadows`, and cap `dpr` at 2.
- [ ] **Step 4: Run.** Expected: PASS. Run `pnpm dev`, then manually confirm clicks on every square resolve to the right number via a debug overlay.
- [ ] **Step 5: Commit** — `git commit -m "feat(client): Three.js board, pieces and picking"`

---

### Task 9: Client store, selection and networking

**Files:**
- Create: `client/src/game/selection.ts`, `client/src/game/store.ts`, `client/src/net/api.ts`, `client/src/net/sse.ts`
- Test: `tests/unit/client/selection.test.ts`

**Interfaces:**
- Consumes: `Snapshot`, `Command` (Task 3); API routes (Task 5).
- Produces: `selectionReducer(s: SelectionState, e: { type: 'click'; sq: Square } | { type: 'reset' }, legal: Turn[]): { state: SelectionState; submit?: string; message?: string }` with `SelectionState = { from: Square | null; landings: Square[] }`; `useGame()` store with `snapshot`, `selection`, `send(cmd)`; `connect(gameId)` that reopens SSE with backoff and reloads `GET` after reconnect.

- [ ] **Step 1: Write failing tests**

```ts
test('click own piece with legal turns -> selected; targets are its first landings');
test('click a piece with no legal turn while a capture exists -> message "Capture required"');
test('click a quiet target -> submit "11-15"');
test('multi-jump: first landing keeps selection open; final landing submits "15x24x31"');
test('two routes sharing a first landing stay pending until they diverge');
test('switching pieces is allowed before the first landing, not after');
test('reset clears a tentative route');
```

- [ ] **Step 2: Run** `pnpm test tests/unit/client`. Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(client): move selection and snapshot sync"`

---

### Task 10: Screens, controls and the MVP end-to-end path

**Files:**
- Create: `client/src/App.tsx`, `client/src/ui/{ReadyScreen,HUD,PausedOverlay,FinishedOverlay,RestartDialog,MoveList}.tsx`, `playwright.config.ts`
- Test: `tests/e2e/mvp.spec.ts`

**Interfaces:**
- Consumes: `useGame()` (Task 9), `<BoardScene>` (Task 8).
- Produces: user-visible copy, fixed by the spec: title "Checkers vs Jev"; "Start game"; "You move first. Captures are mandatory."; "Your turn" / "Jev choosing a move" / "Jev moving"; "Game paused" with "Resume" and "Restart"; "Restart this game?"; "You win" / "Jev wins" / "Draw" with reason; "Play again"; status label "Engine-evaluated" and, when Jev deviates, "Jev chose a lower-rated move"; on phase `ai-error`, "Jev unavailable" with "Retry", "Pause" and "Restart".

- [ ] **Step 1: Write the failing E2E test** (`AI_ENGINE=fake` server flag gives a deterministic engine and Jev):

```ts
test('ready -> start -> move -> AI replies -> pause -> resume -> restart -> fresh game');
test('pause during "Jev choosing a move" freezes the board; resume continues the same game');
test('restart while paused asks for confirmation; Cancel keeps the game');
test('seeded near-final position -> "You win"; Play again starts a clean game; repeat twice');
test('page reload mid-game reconnects to the same gameId and version');
test('Jev fake fails -> "Jev unavailable" with Retry; the board is unchanged; Retry succeeds and the AI moves');
```

- [ ] **Step 2: Run** `pnpm e2e tests/e2e/mvp.spec.ts --project=chromium`. Expected: FAIL.
- [ ] **Step 3: Implement** screens keyed by `snapshot.lifecycle`. The HUD shows turn, piece/king counts, AI status and move list. Start is disabled with a reason when `GET /api/health` reports Jev unconfigured.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then play one full game manually against the real engine and Jev.
- [ ] **Step 5: Commit** — `git commit -m "feat: playable MVP with start, pause and restart"`

**MVP milestone:** Tasks 1–10 green; one manual game completed against real Marcher + Jev.

---

### Task 11: Accessibility, reduced motion and layout

**Files:**
- Modify: `client/src/scene/BoardScene.tsx`, `client/src/ui/*`; Create: `client/src/ui/BoardKeyboard.tsx`
- Test: `tests/e2e/a11y.spec.ts`

- [ ] **Step 1: Write failing E2E tests:** a full game played with keyboard only (arrow keys move a focus ring over squares, Enter selects); every status change is announced through an `aria-live="polite"` region; with `prefers-reduced-motion: reduce`, piece moves complete within 50 ms; at 390 px width the panel stacks under the board and no control is clipped.
- [ ] **Step 2: Run** `pnpm e2e tests/e2e/a11y.spec.ts`. Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(client): keyboard play, live status and reduced motion"`

---

### Task 12: Owner access, abuse and spend guardrails

**Files:**
- Create: `server/security/owner.ts`, `server/security/limits.ts`; Modify: `server/http/routes.ts`
- Test: `tests/integration/security.test.ts`

**Interfaces:**
- Produces: `requireOwner` hook (Manus login if Manus-hosted, otherwise an `OWNER_PASSCODE` session cookie with `SameSite=None; Secure` on HTTPS); `checkOrigin` for state-changing requests; per-session limit of 60 commands per minute; `JEV_DAILY_CALL_LIMIT` default 2,000 → phase `ai-error` with message "Daily AI limit reached".

- [ ] **Step 1: Write failing tests:** unauthenticated command → 401; a game owned by another session → 404; a cross-origin POST → 403; the 61st command in a minute → 429; built client assets contain no `sk-or-` string; error responses never include headers or stack traces; the limit-reached path commits no move and shows the message; a game idle past `GAME_TTL_MINUTES` (default 120) returns 410 and the client shows "Session expired — start a new game".
- [ ] **Step 2: Run** `pnpm test:integration tests/integration/security.test.ts`. Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS. Also run `pnpm build && ! grep -r "sk-or-" dist/` and expect exit 0.
- [ ] **Step 5: Commit** — `git commit -m "feat(server): owner gate and spend guardrails"`

---

### Task 13: Deploy, cross-browser E2E and performance budget

**Files:**
- Create: `Dockerfile` (Node 22, runs `pnpm build`, serves `dist/` via `@fastify/static`, `EXPOSE 3000`, honors `PORT`); Modify: `playwright.config.ts` (projects `chromium`, `webkit`)
- Test: `tests/e2e/perf.spec.ts`

- [ ] **Step 1: Write failing tests:** the whole E2E suite passes on `webkit`; click-to-highlight takes ≤ 100 ms; 20 consecutive real-engine AI turns have a 95th-percentile latency ≤ 5,000 ms; `/api/health` returns 200 from the built container.
- [ ] **Step 2: Run** `pnpm e2e --project=webkit && pnpm e2e tests/e2e/perf.spec.ts`. Expected: FAIL before configuration.
- [ ] **Step 3: Implement** hosting on the temporary Manus cloud sandbox first (forwarding URL), with the key from the OpenRouter API connector's server-side environment, and adjust `budgetMs` (start at 1,500, since Jev adds about 1 s) to meet the latency budget.
- [ ] **Step 4: Run** the full suite: `pnpm typecheck && pnpm lint && pnpm test --coverage && pnpm test:integration && pnpm e2e`. Expected: all PASS, with coverage thresholds met.
- [ ] **Step 5: Commit** — `git commit -m "chore: deployable build with cross-browser and performance checks"`

**Spec-complete milestone:** Tasks 0–13 green; manual games completed in Safari and Chrome on macOS.

---

### Task 14 (Phase 3, optional): KingsRow provider and exact endgames

This task is outlined only. It gets its own detailed plan after decision 4, because it depends on a Windows host and on KingsRow's database terms.

**Files:**
- Create: `engine-host/kingsrow_bridge.py` (pydraughts CheckerBoard wrapper behind a small authenticated HTTP endpoint on the Windows machine), `server/ai/kingsrow/provider.ts`, `server/ai/exact.ts`

**Interfaces:**
- `class KingsRowProvider implements EngineProvider`, selected by `ENGINE=kingsrow`, with Marcher as automatic fallback when the bridge is unreachable.
- Provenance `exact` only when every candidate's value comes from a database lookup with no capture available to either side, inside a covered material slice, and with the game's quiet-turn and repetition counters far enough from their limits not to change the result.

Acceptance at outline level: the same Task 6 conformance tests pass against KingsRow; 500 sampled positions with at most 10 pieces return database values that agree with KingsRow's own lookups; covered endgame wins are converted to actual wins using MTC guidance in self-play.
