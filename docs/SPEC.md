# Spec: Checkers vs Jev

**Status:** Approved with amendments on 9 November 2026; implementation authorized.

**Author:** Manus AI  
**Date:** 9 November 2026

## Decisions (9 November 2026)

1. **Optimal play:** "Practically optimal" is approved: engine-strength play with honest labels now; exact endgame play is a later upgrade. Section 2 is amended accordingly.
2. **Jev's role:** Jev is the opponent's engine from the player's point of view. Jev chooses every AI move from the full list of legal moves. A search engine (Marcher) runs as Jev's analyst, and each candidate move carries its evaluation in Jev's input. Jev's choice is final as long as it is legal.
3. **Hosting:** Run first on the temporary Manus cloud sandbox and its forwarding URL; move to local hosting later if needed.
4. **Rules and draws:** American/English 8×8 checkers, you play red and move first, with automatic third-occurrence and 40-turns-per-side draws, as originally drafted.

Live checks on 9 November 2026 informed decision 2. Without evaluations, Jev's probabilities across the seven opening moves were nearly uniform (0.12–0.18, confidence 0.04). With an evaluation attached to each move, Jev chose the move marked best in 3 of 3 trials with probability 0.95–0.98, in 0.6–1.1 seconds, at about $0.00003 per call.

## 1. Objective and assumptions

Build a personal browser game in which you play checkers against a Jev-backed opponent on an interactive Three.js board. You can start a game, pause and resume it, and restart both during play and after the result. The opponent must play optimally; visual polish must not come at the expense of rule correctness or trustworthy AI behavior.

This draft assumes American/English checkers on an 8×8 board, an untimed game, and a fixed human-first setup: you play red/dark and Jev plays ivory/light. Red/dark moves first under the selected rules. Side selection is not included in v1. [1]

The target is modern desktop browsers, including Safari on macOS, with mouse and keyboard support. A responsive narrow-screen layout is included, but a native mobile app is not. The game is for your private use; accounts, matchmaking, multiplayer, leaderboards, paid tiers, undo, and an AI chat panel are out of scope.

**Important interpretation:** Jev is the decision model used by the opponent, not an agent runtime supplied on its own. Application code owns the runtime and game loop. Jev returns typed decisions rather than prose or reasoning traces. The proposed opponent combines Jev with a deterministic rules engine and an exact checkers engine. If “Jev runtime” means a separate runtime you already have, its interface needs to be supplied before integration. [2]

## 2. What “optimal” means (amended)

The goal remains the game-theoretic order **win > draw > loss**: take forced wins, hold draws, and avoid losses. Checkers is only weakly solved from the starting position, and no accessible engine proves the best reply to every human deviation within seconds. [3] [4] [5] The approved target is therefore **practically optimal** play: every AI move is a legal complete turn, chosen by Jev with a strong search engine's evaluation of every candidate in its input.

Every AI move carries a provenance label. `searched` means the move was chosen from engine search results. `exact` is reserved for a later upgrade in which a verified endgame database covers the position. The interface says "engine-evaluated", never "optimal" or "proven", for a `searched` move. The move record also stores whether Jev chose the engine's top-scored move, so deviations are measurable.

An exact-endgame upgrade (KingsRow with endgame databases on a Windows host) remains a separate, optional later phase.

## 3. Game screen and visual design

Use a restrained tabletop aesthetic: a dark charcoal surrounding surface, warm dark/light board squares, red human pieces, and ivory AI pieces. Give pieces a beveled profile, subtle shadows, and a raised crown mark for kings. The board and pieces are procedural Three.js geometry; decorative downloaded assets are unnecessary.

The desktop screen is board-led, with a compact side panel for controls and status. The panel shows “You” and “Jev,” remaining piece and king counts, whose turn it is, AI analysis status, and a scrollable move history. Narrow screens place the panel below the board. A fixed, elevated camera keeps every square readable; unrestricted camera rotation and zoom are out of scope.

Use raycasting for pointer selection, with a stable mapping from rendered squares to logical squares. Selected pieces receive an outline. Legal destinations receive markers, and mandatory captures receive a distinct marker shape and the message “Capture required.” Do not rely on color alone. Crowned pieces must be distinguishable from men at a glance.

Animate moves with short slides and capture hops. A multi-jump remains one logical turn even when its hops are animated separately. Reduced-motion settings replace movement with instant placement or short fades. Status, buttons, move history, and accessible board controls live in the DOM rather than only inside the canvas.

### Ready screen

Show the fully arranged board and the title “Checkers vs Jev.” The primary button is **Start game**. Show the selected rules and the opponent configuration, plus concise text: “You move first. Captures are mandatory.” No AI inference runs before Start.

If the required AI configuration is unavailable, explain the reason and disable Start. Do not simulate a successful Jev connection. Configuration checks run server-side and never expose the key.

### During play

The controls are **Pause** and **Restart**. Status distinguishes “Your turn,” “Jev analyzing,” “Jev choosing a move,” and “Jev moving.” Human input is disabled during the AI turn and while a committed move is animating. Pause and Restart remain available during AI analysis.

### Paused screen

Overlay “Game paused” with **Resume** and **Restart**. Disable board input and stop presentation animations. Keep the board, turn, history, and any unfinished human capture selection intact. Opening another tab does not automatically resume play.

### Finished screen

Show **You win**, **Jev wins**, or **Draw**, with the reason. Keep the final board visible. Provide **Play again**, equivalent to restarting immediately into a fresh human turn. Pause and Resume are unavailable after a terminal result. Move history remains readable until the new game begins.

## 4. Rules and human interaction

Use the WCDF American/English movement and capture rules, without tournament opening ballots or clocks. Start with 12 men per side on the 32 playable dark squares. [1]

- Men move one adjacent diagonal square forward and capture forward by jumping an adjacent opposing piece onto the empty square beyond.
- Kings move one adjacent diagonal square in either direction and capture forward or backward. They are not flying kings.
- If any capture exists for the player, ordinary moves are illegal. Where several capture choices exist, any legal complete route is allowed; maximum capture is not required.
- A multiple jump must continue with the same piece until its legal route is complete. A captured piece cannot be captured twice.
- Reaching the opposite king row crowns a man and ends its turn immediately, including during a capture. It cannot continue that turn as a new king.
- A player with no legal move on their turn loses, including when pieces remain but are blocked. [1]

Select a human piece, then a highlighted destination. For multiple jumps, select successive highlighted landing squares. Once the capture starts, selection is restricted to that piece. An invalid click leaves the game unchanged and displays a brief explanation. Switching pieces before the first step is allowed.

The frontend keeps a tentative multi-jump selection separate from the authoritative board. Only a complete legal route is submitted and committed as one transaction. The UI must never pass the turn halfway through a mandatory capture. Pause preserves the tentative route; restart discards it.

### Digital draw policy

For v1, use automatic digital adjudication instead of a referee-based draw claim. This is an explicit adaptation of the official claim procedure, not a claim that WCDF rules automatically end games this way. The selected exact engine must support this adaptation. [1]

A draw occurs at completed-turn boundaries when the same position occurs for the third time, or when each side has completed 40 turns without either side advancing a man or capturing a piece. Maintain separate per-side no-progress counts; a capture or a man advancing resets both counts. This is 40 turns **per side**, not 40 total half-moves. [1]

For repetition, a position includes all piece squares, colors, man/king status, and side to move. Preserve repetition history and no-progress counts. An exact solver must evaluate this complete state, not merely identical-looking boards reached through different histories. [3]

After a committed move, check whether the opponent has lost through having no legal move before applying draw adjudication. No draw-by-agreement control is included in v1.

## 5. Lifecycle, pause, and restart contract

The authoritative lifecycle is `ready`, `playing`, `paused`, or `finished`. During play, the server's turn phase is `human-input`, `ai-thinking`, or `ai-error`. Engine analysis and Jev's choice both happen inside `ai-thinking`, and the client may show them as separate statuses. Animation is a client presentation state and does not change the rules state.

**Start:** A valid Start command changes `ready` to `playing` on the human turn. Repeated clicks cannot create additional games or start multiple AI jobs.

**Pause:** A server-accepted Pause freezes the logical game and cancels outstanding analysis or Jev selection where cancellation is supported. Best-effort network cancellation does not guarantee that an already-sent provider request stops running or billing. Its result is nevertheless prevented from changing the board.

A move committed before Pause is accepted remains committed. Pausing does not undo it. An animation may freeze partway visually; after Resume it completes or reconciles to the committed board. There must never be a half-committed logical move.

**Resume:** Continue the same game and turn. If paused on an AI turn, start one fresh AI job. Never start duplicate jobs. Resume cannot revive a finished game.

**Restart during play or pause:** Show an in-app “Restart this game?” confirmation. Cancel abandons the dialog without changing the game. Confirm invalidates the old game generation and immediately begins a fresh human-first game. Reset pieces, kings, selection, captures, repetition history, progress counts, turn, move history, result, timers, and AI job metadata. Camera and accessibility preferences may persist.

**Restart after the end:** Play again starts immediately, without an abandonment confirmation. This action works after every win, loss, or draw, including repeated games.

Serialize game commands and AI commits. Every asynchronous result carries its game ID, generation, state version, and AI job ID. Before committing, check ownership, freshness, lifecycle, active turn, and legal-move membership. Late responses after pause, restart, expiry, or another committed command cannot alter the board.

## 6. Jev as the opponent's engine (amended)

The application-owned opponent runtime follows this sequence:

```text
Authoritative state + history
    -> Generate all legal complete-turn moves
    -> Marcher (analyst) evaluates every legal move within a time budget
    -> Jev Choice selects one move ID from ALL legal moves, each annotated with its evaluation
    -> Validate identity, legal membership, and freshness
    -> Commit the entire move atomically
    -> Animate the resulting move and announce the next turn or result
```

Jev makes the decision; the engine is its information source and never overrides it. Jev's input lists every legal move with its path, captures, promotion flag, and engine evaluation, together with compact board state and recent history. A legal Jev choice is committed even if it is not the engine's top-scored move; the move record notes the deviation.

Call Jev once per AI turn. When only one legal move exists, it is played without a Jev call and labeled `forced`, because a one-option choice carries no decision. Do not call Jev per frame, per hover, or per jump. Send no screenshots and no growing chat transcript.

### OpenRouter integration

Use the documented Decisions API, **not** an assumed chat-completions interface: `POST https://openrouter.ai/api/alpha/decisions`. Authenticate with the server-side `OPENROUTER_API_KEY`. Propose `JEV_MODEL=typesafe/jev-1.14`, currently documented as supported, and pin the version rather than using a floating latest alias. Contract-test it before implementation acceptance and whenever the version changes. [2] [6]

The request uses `model`, `state`, and `questions`. A move question has `type: "choice"`, instructions to choose among the supplied legal moves using their engine evaluations, and a `criteria` object whose keys are canonical move IDs for every legal move. Read `answers.move.choice`, validate the response schema, then look up the move in the legal move set. Move paths and captures come from the server, never from invented model output. [6]

Do not show Jev confidence as the probability of winning. It describes the model's decision distribution and is not proof of checkers optimality. Jev does not supply natural-language explanations; any brief move labels in v1 are deterministic templates based on validated facts. [2] [6]

### Failure behavior

Give each Jev call a configurable timeout, initially five seconds, with at most one retry for transient transport, rate-limit, or upstream server failures. Do not repeatedly retry invalid credentials. The exact-analysis deadline is separate and remains subject to solver feasibility testing.

Because Jev is the engine, there is no silent substitute. If Jev is still unavailable after its one retry, or returns an ID that is not a legal move, the AI does not move. The game enters `ai-error` and shows "Jev unavailable" with **Retry**, **Pause**, and **Restart**, leaving the board unchanged. If the analyst engine fails, Jev still chooses, from the legal moves without evaluations, and the move is labeled "unanalyzed".

## 7. Architecture and state contracts

**Stack (amended):** TypeScript in strict mode; React and Vite for the DOM interface; Three.js via React Three Fiber for the board; a Node.js/Fastify backend; Zod for boundary validation; Vitest for unit and integration tests; Playwright for end-to-end tests. The analyst engine is Marcher (MIT) as WebAssembly in a Node worker thread. Versions are pinned in the lockfile.

The backend owns the canonical game. The browser renders snapshots and submits actions. Rules are a pure shared module; the renderer, Jev adapter, and engine adapter cannot mutate the board directly. CPU-heavy search must run outside the request handler so Pause and Restart remain responsive.

Canonical state includes game identity and generation, version, rules version, lifecycle, turn phase, side to move, the 32-square board, move history, repetition counts, per-side no-progress counts, terminal result, and active AI job metadata. A man becoming a king is a state change, not merely a visual effect.

A move includes a canonical ID, origin, complete landing path, captured squares, and promotion result. A full-state analysis key includes the rules and relevant history as well as board and turn. Never cache exact evaluations by board layout alone.

**API boundaries:** `POST /api/games` creates a ready game; `GET /api/games/:id` returns a snapshot; `POST /api/games/:id/start`, `/moves`, `/pause`, `/resume`, `/restart`, and `/retry-analysis` handle validated commands. Commands carry an expected version and an idempotency ID. A restart returns the new game identity. Stale commands return a conflict and the current snapshot rather than applying twice. Use server-sent events for snapshots and AI status, with a snapshot fetch after reconnect.

For v1, active-game state may be ephemeral server memory in a single-instance deployment. A normal browser refresh can reconnect while the session remains alive; surviving a server restart or long-term saving is not promised. If the session expires, show “Session expired — start a new game.” The deployment must not silently scale this in-memory design across independent replicas.

### Proposed project structure

```text
client/src/ui/             DOM controls, overlays, status, accessible board input
client/src/scene/          Three.js board, pieces, picking, and animations
client/src/game/           Snapshot state and tentative human move selection
shared/rules/             Pure rules, move generation, adjudication, serialization
shared/contracts/         Validated API and snapshot contracts
server/game/              Session store, lifecycle, command serialization
server/ai/                Opponent runtime and exact-engine adapter
server/integrations/      Server-only OpenRouter/Jev client
server/security/          Private access, session ownership, request limits
tests/unit/               Rules and state-machine tests
tests/integration/        Engine/Jev contracts and cancellation races
tests/e2e/                Start, interaction, pause, restart, and results
docs/                     Approved spec and future implementation documentation
```

### Code style

Use two-space indentation, camelCase for functions and values, PascalCase for types and React components, and discriminated unions for lifecycle and analysis results. Pure rule functions return a new state rather than mutating rendering objects. Illustrative contract—not implementation:

```typescript
export type ExactMoveAnalysis =
  | {
      status: 'proven';
      fullStateKey: string;
      outcome: 'win' | 'draw' | 'loss';
      optimalMoveIds: readonly string[];
      evidenceId: string;
    }
  | {
      status: 'unknown';
      reason: 'timeout' | 'unsupported-state' | 'engine-unavailable';
    };
```

A `proven` label is accepted only from a validated engine capability and sound exact result; changing a heuristic response's label is not proof.

## 8. Security, cost, and operating boundaries

Store the OpenRouter key through protected server-side secret configuration. Read it only in the backend at runtime; the frontend build must not require or consume it. Never put it in browser-prefixed environment variables, frontend bundles, HTML, localStorage, screenshots, source control, or client-visible error responses. No key is needed for approving this specification. [6]

Require private owner access before a hosted version can trigger calls billed to your key. Validate session ownership on every command, protect cookie-authenticated writes against cross-site requests, and never expose an arbitrary OpenRouter forwarding endpoint. One active AI job per game, bounded request bodies, request limits, and a configurable server-side spend ceiling prevent accidental request storms. Show a recoverable limit-reached state instead of continuing to spend.

Log job IDs, model versions, durations, usage when provided, proof references, and fallback events without authorization headers or secrets. Provider data policies and final hosting choices need review before deployment.

**Always:** Validate inputs and moves, preserve full rules state, reject stale work, keep inference server-side, and run affected checks before delivery.

**Ask first:** Relaxing optimal play; changing the checkers variant or draw policy; adding a second AI provider, accounts, persistence, paid services, or public access; selecting an engine with material licensing or hosting cost obligations.

**Never:** Invent an engine guarantee, label a searched move "optimal" or "proven", commit secrets, allow Jev to bypass rule validation, silently substitute a non-Jev move, or remove failing rule tests to obtain a green build.

## 9. Commands and testing strategy

These are proposed package scripts for the future project; they do not imply an initialized repository or completed checks:

```bash
pnpm install --frozen-lockfile
pnpm run dev -- --host 0.0.0.0 --port 3000
pnpm run typecheck
pnpm run lint
pnpm run test -- --run --coverage
pnpm run test:integration -- --run
pnpm exec playwright test
pnpm run build
pnpm run start -- --host 0.0.0.0 --port 3000
```

The dev command serves the frontend and backend on one origin. The build compiles both; start serves the production output. Exact package-manager and dependency versions are pinned when implementation starts.

**Unit tests:** Cover opening setup, forward-only men, short kings, compulsory capture, multiple capture choices, no maximum-capture requirement, complete multi-jumps, no repeated captured victim, promotion ending the turn, blocked-player loss, repetition, and 40-turns-per-side draws. Require at least 95% branch coverage for the pure rules and lifecycle modules, plus explicit fixtures for these cases.

**Integration tests:** Use deterministic fake Jev and engine responses for transport failures, malformed outputs, unknown move IDs, stale state, duplicate commands, pause/restart races, and history-sensitive engine results. Run a minimal live Jev contract test only with explicit cost-aware test configuration. Validate the eventual solver's actual rules, coverage, result semantics, and provenance; fixture success alone cannot establish full optimality.

**End-to-end tests:** Exercise ready-to-start, legal human input, mandatory captures, AI response, pause on either turn, pause during animation, resume, restart with work in flight, each terminal result, and repeated Play again. Include keyboard-only interaction and narrow layouts. Manually verify Three.js picking and WebGL support in macOS Safari and a current Chromium browser.

**Performance targets:** Local selection feedback within 100 ms; controls remain responsive during analysis; a roughly 60 fps board on a typical modern laptop with an adjustable pixel-ratio cap. Aim for AI decisions within five seconds at the 95th percentile on agreed test hardware and representative positions, but do not cap exact search by substituting unproven moves. Solver correctness, full coverage, and practical latency must all be resolved before strict-optimal acceptance.

## 10. Acceptance criteria

1. Before Start, the correctly arranged 8×8 board is visible and no move or AI inference begins.
2. Start begins exactly one game on your turn. Legal mouse and keyboard input works, and illegal moves leave the canonical state unchanged.
3. The complete selected movement, capture, promotion, victory, and digital draw rules are enforced by the backend and reflected in the UI.
4. Every AI move is legal and chosen by Jev from all legal moves annotated with engine evaluations, except a single forced move. Each move records its provenance and whether it matched the engine's top choice.
5. Pause preserves the same game and blocks further logical moves after it is accepted. Resume continues the correct turn without duplicated work.
6. Restart during play or pause clears all game-specific state. Responses from the abandoned game cannot modify the new one.
7. Every terminal result displays the final board and reason. Play again works immediately after a win, loss, or draw and on repeated runs.
8. Jev and engine failures are recoverable. A Jev failure never results in a substituted move, and no searched move is presented as proven.
9. The OpenRouter key is absent from client assets and responses. Only your authorized session can incur inference charges.
10. The rules, lifecycle, integration, and end-to-end checks pass, including the step-level rules-equivalence check between the rules core and Marcher. A visual prototype alone does not satisfy this criterion.

## 11. Approval record

The approval questions from the draft were answered on 9 November 2026; see "Decisions" at the top. The implementation plan is `docs/plans/2026-11-09-checkers-vs-jev.md`.

## References

[1]: https://wcdf.net/rules/rules_of_checkers_english.pdf "WCDF Rules of Draughts, English checkers"
[2]: https://openrouter.ai/docs/guides/community/jev "OpenRouter Jev documentation and typed Decisions API overview"
[3]: https://www.science.org/cms/asset/7f2147df-b2f1-4748-9e98-1ac3afccfb76/pap.pdf "Schaeffer and colleagues, Checkers Is Solved, Science 2007"
[4]: https://webdocs.cs.ualberta.ca/~chinook/ "University of Alberta Chinook official homepage"
[5]: https://webdocs.cs.ualberta.ca/~chinook/databases/ "University of Alberta Chinook Endgame Databases"
[6]: https://openrouter.ai/docs/guides/community/jev-tutorial.md "OpenRouter Jev tutorial, request schema and server-side key guidance"
