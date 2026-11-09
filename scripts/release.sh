#!/usr/bin/env bash
# Gated release: a commit reaches <remote>/main (which records a Manus checkpoint and, with
# auto-publish on, deploys) only after every quality gate passes on exactly that commit.
# Usage: pnpm release            (remote defaults to origin)
#        RELEASE_REMOTE=other pnpm release
set -euo pipefail
cd "$(dirname "$0")/.."
remote=${RELEASE_REMOTE:-origin}

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree has uncommitted changes; commit or stash them first." >&2
  exit 1
fi

git fetch "$remote" main
if git rev-parse -q --verify "refs/remotes/${remote}/main" >/dev/null; then
  if ! git merge-base --is-ancestor "${remote}/main" HEAD; then
    echo "HEAD does not contain ${remote}/main. Integrate it (git merge ${remote}/main), then re-run." >&2
    exit 1
  fi
fi

bash scripts/verify.sh
git push "$remote" HEAD:main
echo "Released $(git rev-parse --short HEAD) to ${remote}/main."
