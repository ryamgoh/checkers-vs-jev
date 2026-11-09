# Checkers vs Jev: build evaluation

*Manus AI · 9 November 2026 · Planning review of [SPEC.md](./SPEC.md); no product code written. Spike scripts are in `spikes/`.*

## What you can build, in one paragraph

You can build every visible part of the request: a polished Three.js checkers board, a Start screen, Pause/Resume, Restart during and after a game, and an opponent whose moves pass through Jev. You can also make that opponent extremely strong, because a free, MIT-licensed engine (Marcher) already runs in Node as WebAssembly and searches 14–17 plies per move in 0.5–3 seconds in this sandbox. What nobody can currently build is an opponent that **proves** every move is game-theoretically optimal after any mistake you make. Checkers is only solved from the starting position, and no public engine or service answers arbitrary midgame positions exactly in seconds [1] [2]. The realistic target is therefore "practically optimal": engine-grade play everywhere, with exact play added in covered endgames later.

## How hard is it?

Overall difficulty is **medium**. Most of the work is ordinary, well-trodden web-game engineering, and the hardest computer-science problem (playing checkers well) is already solved by existing engines. The work concentrates in three places: making the server the single source of truth so Pause and Restart cannot race with the AI, adapting the engine's one-jump-at-a-time output to whole turns, and the 3D interaction details for multi-jumps.

A rough budget for one experienced developer is about **9 focused working days to a playable MVP, about 15 to a spec-complete product, and about 24 including the optional maximum-strength upgrade**. These are planning estimates, not benchmarks.

![Phased roadmap](diagrams/roadmap.png)

## The one decision that changes the plan: what "optimal" means

The spec currently treats provable optimality as a blocking requirement. The research shows that gate cannot be passed with anything available today. Strong engines use selective search and learned evaluation, which are not proofs, and exact endgame tables only cover positions with few pieces and carry coverage exclusions [2]. Even KingsRow's new 12-piece database, announced in September 2026, needs about 2.88 TB installed and improves analysis rather than solving midgames [3].

So the choice is between three honest definitions:

1. **Practically optimal (recommended for MVP).** The AI plays the engine's best-searched move, Jev chooses only among moves the engine scores as equally good, and the UI labels moves as "engine best," never "proven." This is buildable now.
2. **Practically optimal plus exact endgames (Phase 3).** Same as above, but once the position falls inside a verified endgame database, moves are exact and labeled "exact." This needs a Windows worker running KingsRow and roughly 100 GB of database files [3].
3. **Provably optimal everywhere (as currently written).** Not buildable with any known engine, database or service. Keeping this requirement means the project stops at the feasibility gate.

The plan below assumes option 1 for the MVP and option 2 as the upgrade. That requires your approval to amend Section 2 of the spec, because the spec says relaxing optimal play is an "ask first" change.

## What the spikes proved

Two short experiments were run in this sandbox before writing the plan, so the stack choices rest on measured behavior rather than README claims.

**rapid-draughts is a trustworthy rules library but not a strong AI.** Its English move generator reproduced the standard perft counts exactly: 36,768 at depth 6, 845,931 at depth 8 and 3,963,680 at depth 9. That is strong evidence its capture and promotion logic matches the reference. Two defects matter, though. Its search scores a draw the same as a loss, and its "since non-king advance" counter never resets, so its built-in draw rule is effectively "40 plies without capture" with no repetition check. The plan uses it only for move generation and implements draw adjudication separately. Its own alpha-beta needed about 3 seconds to reach depth 10, and its move generator ran at roughly 240,000–390,000 nodes per second [4].

**Marcher's WebAssembly engine loads in Node unmodified and is about 50 times faster.** The published 190 KB WASM build ran perft at about 15 million nodes per second and completed iterative-deepening searches of depth 14 in 0.5 seconds, depth 16 in 1 second and depth 17 in 3 seconds. Its author reports it at about 50 Elo below KingsRow 1.19e at 0.5 seconds per move; that claim is not independently verified [5].

One discrepancy was investigated: Marcher's perft diverges from the reference at depth 7. Reading its source showed the cause is a counting convention, not a rules bug. Marcher counts each jump of a multi-jump as its own ply, while the reference counts a whole turn as one. The adapter must therefore assemble Marcher's single steps into complete turns, and the plan includes a step-level equivalence test to prove both engines agree on the rules.

Two other integration facts came from the source. Marcher's search is synchronous inside WASM, so the clean way to honor Pause is to terminate the worker thread and start a fresh one. It also keeps game history in process-global memory, so each active game needs its own worker.

## Technology stack and what can be reused

Almost everything except the game-specific glue is an existing library. The table marks what is reused and what must be written.

| Part | Use | Build or reuse | Difficulty |
| --- | --- | --- | --- |
| 3D board and pieces | three 0.187, @react-three/fiber 9.8, @react-three/drei 10.7 (MIT) | Reuse; procedural geometry, no model assets | Medium |
| Piece animation | @react-spring/three 10.1 (MIT) | Reuse | Easy |
| Picking (clicks on squares) | R3F pointer events (built-in raycasting) | Reuse | Easy |
| DOM UI, screens, controls | React 19, Vite 8 | Reuse; screens are custom | Easy |
| Client state | Zustand 5 | Reuse | Easy |
| Multi-jump selection logic | — | **Write** (small reducer) | Medium |
| Move generation and legality | rapid-draughts 1.0.6 English (MIT), perft-verified | Reuse, wrapped | Easy |
| Draw adjudication, move IDs, jump paths | — | **Write** (repetition, 40-per-side, path reconstruction) | Medium |
| Game lifecycle and race safety | XState 5 (MIT) | Reuse the machine; **write** versioning, generations | Medium–hard |
| HTTP API and live updates | Fastify 5 + server-sent events, Zod 4 validation | Reuse | Easy |
| Opponent engine | Marcher WASM (MIT) in Node `worker_threads` | Reuse; **write** step-to-turn adapter | Medium |
| Jev move choice | OpenRouter Decisions API, `typesafe/jev-1.14` Choice; @openrouter/sdk 1.5 or plain fetch | Reuse; **write** request builder, fallbacks | Easy |
| Max-strength upgrade | KingsRow 1.20 + 10-piece WLD/MTC via pydraughts 0.6.7 CheckerBoard bridge | Reuse; **write** Windows worker | Hard (ops) |
| Testing | Vitest 5, fast-check 4 (property tests), Playwright 1.65 (Chromium and WebKit) | Reuse | Medium |

Versions were read from the npm registry on 9 November 2026. Libraries deliberately excluded: npm `draughts` is a 10×10 international-rules library, not English checkers; GSAP works but uses a custom license where MIT alternatives exist; rapid-draughts' own AI is excluded for the draw-scoring defect described above [5].

## Architecture

The browser only renders and sends commands. The Node server owns the game, validates every move, and runs the opponent. The engine runs in a worker thread so the server stays responsive during a search, and the Jev key never leaves the server.

![Architecture](diagrams/architecture.png)

The opponent runtime works the same way regardless of engine. It asks the engine to rank the legal turns, keeps only the turns tied with the best score, and asks Jev, via a Choice question, to pick one by move ID. It then checks that the chosen ID is in the allowed set and that the game has not been paused or restarted in the meantime, and commits the whole turn at once. If Jev times out, refuses, or returns an unknown ID, the engine's best move is played and the move is visibly marked as an engine fallback. The Decisions API returns typed answers with probabilities, including a possible `refusal` answer type, so these cases are expected inputs rather than errors [6].

In tied positions, Jev's choice gives the opponent some variety without weakening it. Under the recommended definition, Jev never overrides the engine's strength. A small optional extension, deferred to after the MVP, is a Jev Score question that decides how long the engine should think based on how sharp the position looks.

## MVP: the smallest version worth playing

The MVP is a single-player game you can play end to end in a browser against the Jev-backed opponent, served by a small Node server that holds your OpenRouter key.

It includes the 8×8 board in Three.js, with click-to-select, highlighted legal destinations, mandatory-capture marking, multi-jumps selected landing by landing, crowning, and short move animations. It includes all four screens and states from the spec: Ready with Start, Playing, Paused with Resume and Restart, and Finished with the result and Play again. Restart works during play, while paused, and after the game ends. The full rules are enforced on the server, including wins by no legal moves and both automatic draw rules. The opponent is Marcher plus Jev with visible fallback, and moves are labeled "engine best."

The MVP deliberately leaves out the owner login, spend ceiling, keyboard-only play, reduced-motion mode, Safari end-to-end runs, hosting, and the exact-endgame upgrade. Those complete the spec in Phase 2 and Phase 3. Running locally, it is safe because the key stays in a server-side environment variable.

## Implementation phases

**Phase 0, de-risk (about 2 days).** Confirm the decisions below, amend the spec's optimality section, pin the Marcher build, and turn the spikes into automated checks.

**Phase 1, MVP (about 7 days).** Build the rules core and adjudication, then the server lifecycle, engine worker and Jev integration, in parallel with the Three.js board. Finish with the screens and an end-to-end test of start, play, pause, restart and Play again.

**Phase 2, spec-complete (about 6 days).** Harden race conditions, add accessibility and reduced motion, add owner-only access, rate limits and a spend ceiling, deploy, and run the full test pyramid in Chromium and Safari's WebKit engine.

**Phase 3, optional maximum strength (about 9 days).** Add a KingsRow worker on a Windows machine with its opening book and 10-piece databases, behind the same engine interface, and label covered endgame moves as exact. KingsRow's redistribution terms are unpublished, so it stays on your own machine unless its author agrees otherwise [3].

The task-by-task plan, with files, interfaces, tests and commands, is in [docs/plans/2026-11-09-checkers-vs-jev.md](./docs/plans/2026-11-09-checkers-vs-jev.md).

## Hosting options

For local play, the MVP needs only Node 22 and the key in an environment variable. For a hosted version, two routes fit. A Manus web or Three.js game project with its server enabled can run the Node server and the WASM engine in its container, and Manus login can restrict play to you. Any ordinary Node host, such as a small VPS, works the same way. The Phase 3 KingsRow worker is different: it needs a persistent Windows machine with about 100 GB of SSD space, which no standard web container provides [3].

## Risks to watch

The biggest product risk is expectation: if "optimal" stays undefined, the first time the AI misses a forced win or settles for a heuristic draw it will read as a broken promise, so move labels must be honest from the first build. The biggest engineering risk is the Pause/Restart race against an in-flight AI move; the plan addresses it with versioned commands, game generations and worker termination, and gives it its own tests. Marcher is a single-author project with recent activity but no independent strength verification, so the engine sits behind an interface that KingsRow can replace. Jev is billed per input token, at $0.042 per million input tokens on the model page, so one call per AI turn costs fractions of a cent; the spend ceiling exists to stop runaway loops, not normal play [7].

## Decisions needed from you

1. **Optimal play:** Approve "practically optimal" for the MVP, with exact endgames as the Phase 3 upgrade, and the matching spec amendment?
2. **Jev's role:** Is Jev choosing among the engine's equally good moves the right role, with the engine's best move as a visible fallback, and Jev skipped when only one legal move exists?
3. **Hosting:** Local first, Manus-hosted with your login, or your own server?
4. **Phase 3:** Do you have, or want, a Windows machine for KingsRow, or should Marcher remain the final engine?

## References

[1]: https://www.science.org/cms/asset/7f2147df-b2f1-4748-9e98-1ac3afccfb76/pap.pdf "Schaeffer and colleagues, Checkers Is Solved, Science 2007"
[2]: ./engine-landscape.md "Manus AI, English-checkers engine landscape, 9 November 2026"
[3]: https://edgilbert.org/EnglishCheckers/12-pieceEnglishDB.htm "KingsRow 12-piece English database requirements"
[4]: https://github.com/loks0n/rapid-draughts "rapid-draughts WCDF TypeScript rules library"
[5]: https://github.com/Stermere/Checkers-Engine "Marcher MIT checkers engine with WebAssembly build"
[6]: https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request.md "OpenRouter Decisions API reference"
[7]: https://openrouter.ai/typesafe/jev-1.14 "OpenRouter Jev 1.14 model page and pricing"
