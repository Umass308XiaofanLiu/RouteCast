#!/usr/bin/env bash
# Deploy the static Vite build to the gh-pages branch as a normal (fast-forward) commit.
# Usage: bash scripts/deploy-gh-pages.sh   (requires push access to origin)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
REMOTE="$(git remote get-url origin)"
SHA="$(git rev-parse --short HEAD)"
npm run build
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git clone --quiet --branch gh-pages --depth 1 "$REMOTE" "$WORK"
find "$WORK" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -r dist/. "$WORK"/
touch "$WORK/.nojekyll"
cd "$WORK"
git add -A
if git diff --cached --quiet; then echo "gh-pages already up to date"; exit 0; fi
git commit --quiet -m "Deploy GlarePilot $SHA (static Vite build)"
git push --quiet origin gh-pages
echo "Deployed $SHA to gh-pages"
