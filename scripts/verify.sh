#!/usr/bin/env bash
# Runs every quality gate in CI order. Same commands as .github/workflows/ci.yml.
# Usage: pnpm verify            (all gates)
#        pnpm verify --skip-e2e (skip the browser suite, e.g. for a quick local check)
set -euo pipefail
cd "$(dirname "$0")/.."

run() {
  local name=$1
  shift
  local started=$SECONDS
  echo "::: ${name}"
  "$@"
  echo "    passed in $((SECONDS - started)) s"
}

run "lint" pnpm -s lint
run "type check" pnpm -s typecheck
run "unit tests" pnpm -s test
run "integration tests" pnpm -s test:integration
run "production build" pnpm -s build
run "dependency audit (production, high+)" pnpm audit --prod --audit-level high
if [[ "${1:-}" != "--skip-e2e" ]]; then
  run "end-to-end tests" pnpm -s e2e
fi
echo "All gates passed."
