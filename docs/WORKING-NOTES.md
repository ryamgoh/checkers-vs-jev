# Working notes: CI/CD + publish (2026-11-09)

Project: /home/ubuntu/checkers-vs-jev (git, main; commits cb6e93a, e898044, 2bb1439, de508e5).
Spec and plan docs: /home/ubuntu/checkers-spec (SPEC.md, BUILD-EVALUATION.md, docs/plans/..., jev-source-notes.md).

State before CI/CD:
- Tests: 80 unit+integration (vitest), 9 Playwright e2e (fake Decisions API on :4100, app on :3100), typecheck clean.
- Live server running as a service on :3000 (NODE_ENV=production, serves dist/), temp URL
  https://3000-i9lzefkhkblxsc8p3adhx-b6edf6a3.sg2.manus.computer
- Live self-play (2 games): Jev won both; AI p50 2.2 s, p95 2.8 s, max 4.2 s; 26/29 matched engine top score.
- Scripts: build = vite build (client -> dist), start = NODE_ENV=production tsx server/index.ts.
- Runtime needs: Node 22, worker_threads + WASM (server/ai/marcher/vendor), SSE, in-memory games => single instance.
- Secret: OPENROUTER_API_KEY (server env only). Optional JEV_MODEL, ENGINE_BUDGET_MS, etc.
- Health endpoint: GET /api/health (unauthenticated 200).

Publishing constraints (from Manus skills):
- WebDev is the default host. Container deploy = features.server:true + deploy {dockerfilePath, healthPath}.
- Autoscale = up to 5 pods (breaks in-memory games); Reserved = single persistent process; both 1 vCPU / 512 MB.
- Must read references/reserved-hosting-reference.md before recommending Reserved or quoting cost.
- Checkpoint = commit pushed to origin/main of the canonical repo; publish is separate (never enable auto_publish myself).
- Preview cookies: WebDev Preview is a cross-site iframe; SameSite=Strict cookies fail there -> use SameSite=None; Secure on HTTPS.
- GitHub: create repos --private by default; never gh auth login.
