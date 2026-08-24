#!/usr/bin/env bash
# Verify build locally, push to main, wait for Vercel, smoke-check /company.
set -euo pipefail
cd "$(dirname "$0")/.."

MSG="${1:-Update airsup}"
REMOTE="${2:-origin}"
BRANCH="${3:-$(git branch --show-current)}"

echo ""
echo "=== Airsup push-live ==="
echo ""

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "[ERROR] Not a git repository."
  exit 1
fi

echo "→ typecheck..."
npm run typecheck

echo "→ production build..."
npm run build

if ! git diff --cached --quiet 2>/dev/null; then
  :
elif [ -n "$(git status --porcelain)" ]; then
  git add -A
fi

if ! git diff --cached --quiet 2>/dev/null; then
  echo "→ commit: $MSG"
  git commit -m "$MSG"
else
  echo "→ nothing new to commit"
fi

echo "→ push $REMOTE $BRANCH..."
git push -u "$REMOTE" "$BRANCH"

SHA="$(git rev-parse HEAD)"
echo "→ waiting for Vercel (commit ${SHA:0:7})..."

if ! command -v gh >/dev/null 2>&1; then
  echo "[WARN] gh CLI missing — skipped deploy wait. Check Vercel manually."
  exit 0
fi

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "")"
if [ -z "$REPO" ]; then
  echo "[WARN] Could not resolve GitHub repo — skipped deploy wait."
  exit 0
fi

for _ in $(seq 1 40); do
  STATE="$(gh api "repos/$REPO/commits/$SHA/status" --jq '.state' 2>/dev/null || echo "pending")"
  if [ "$STATE" = "success" ]; then
    echo "✓ Vercel deploy succeeded"
    break
  fi
  if [ "$STATE" = "failure" ]; then
    echo "✗ Vercel deploy FAILED"
    gh api "repos/$REPO/commits/$SHA/status" --jq '.statuses[] | {context, description, target_url}' 2>/dev/null || true
    exit 1
  fi
  sleep 5
done

if [ "${STATE:-pending}" != "success" ]; then
  echo "[WARN] Deploy still pending after ~3 min — check Vercel dashboard."
  exit 0
fi

echo "→ smoke check https://airsup2.vercel.app/company ..."
HTTP="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "https://airsup2.vercel.app/company" || echo "000")"
if [ "$HTTP" = "200" ]; then
  echo "✓ /company returns 200"
else
  echo "[WARN] /company returned $HTTP (may still be propagating)"
fi

echo ""
echo "=== Live: https://airsup2.vercel.app/ ==="
echo ""
