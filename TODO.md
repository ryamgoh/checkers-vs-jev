# TODO — Checkers vs Jev

Source: the user's request ("Build a checkers board, where the player will play against an AI, of which the agent's
runtime will be Jev … use a three.js game board … the AI should play optimally … a game screen that allows us to click
start and we can pause / restart (after end as well)"), the follow-up decision ("we just work with Jev's moves where the
engine is Jev basically"), "CICD this, and then publish this", and the confirmed project brief.

## Gameplay and AI (delivered in the imported codebase)

- [x] **Interactive three.js 3D checkers board.** I play my moves on a three.js game board by clicking pieces and
  destination squares, including multi-jump routes, with clear feedback for the selected piece and its legal moves.
- [x] **Complete checkers rules.** Legal moves, mandatory captures, multi-jumps, king promotion, turn progression and
  win/loss/draw detection are enforced by the server; the board never shows an illegal position.
- [x] **Jev is the AI opponent and chooses every AI move.** The AI's runtime is Jev (OpenRouter's Jev decision model,
  using my OpenRouter key). Jev selects every AI move ("the engine is Jev basically"); the server validates Jev's answer
  as legal before updating the board, and a Jev failure never substitutes a different move. The AI should play
  optimally: Jev is given engine evaluations of every legal move so it can choose the strongest one.
- [x] **Key stays server-side.** The OpenRouter key is read from the server environment only and is never sent to the
  React client; the client talks only to the game endpoints.
- [x] **Game screen controls.** A game screen lets me click Start; I can Pause and Resume, and Restart — including after
  the game has ended.
- [x] **Clear gameplay feedback.** Current turn, paused state, AI-thinking state, errors (with Retry) and the final result
  are shown.

## CI/CD and publication

- [x] **Automated CI.** On each relevant change, CI installs dependencies from the lockfile, builds the client and server,
  and runs the existing checks: lint, type check, unit, integration and browser end-to-end tests, a production
  dependency audit, and a container image build-and-boot smoke test (`.github/workflows/ci.yml`; locally `pnpm verify`).
- [x] **Deployment configuration.** A Dockerfile builds and runs the Fastify server serving the client, with an
  unauthenticated health endpoint at `/api/health`, declared to Manus as the container deploy.
- [x] **Environment-based OpenRouter credentials in production.** The published server reads `OPENROUTER_API_KEY` from
  project secrets, never from the image or repository. (Declared as a project secret, configured for all environments.)
- [x] **Continuous delivery with a documented release setup.** Only commits that pass every gate reach `main`
  (`pnpm release`); each accepted `main` commit is a Manus checkpoint that can be published; the release flow is
  documented in the README. Hosting: default Autoscale (Reserved was declined; trade-off documented in the README).
- [ ] **CI runs on GitHub.** The repository lives on GitHub so the Actions workflow runs on pushes and pull requests.
- [x] **Published.** The game is published and plays end-to-end against live Jev there: version 62f8c56 at
  https://checkers-fhpj2xmn.manus.space (visibility: private to the owner until changed in the publish card).
  Live check with the client's event stream open: three Jev replies in 1.9–2.4 s, each with engine analysis and each
  matching the engine's best move; cross-site writes refused (403); key absent from the page.
