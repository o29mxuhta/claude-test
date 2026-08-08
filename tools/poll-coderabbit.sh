#!/usr/bin/env bash
# Poll CodeRabbit review status on a GitHub PR until it completes.
# Usage: tools/poll-coderabbit.sh <PR_NUMBER> [INTERVAL_SECONDS] [MAX_POLLS]
#
# Uses GitHub commit status API (CodeRabbit sets commit status to "pending"
# during review and "success" when complete, per its commit_status config).

set -euo pipefail

PR="${1:?Usage: poll-coderabbit.sh <PR_NUMBER> [INTERVAL_SECONDS] [MAX_POLLS]}"
INTERVAL="${2:-30}"
MAX_POLLS="${3:-10}"
REPO="${REPO:-maorcc/oref-map}"

head_sha=$(gh api "repos/$REPO/pulls/$PR" --jq '.head.sha')

for i in $(seq 1 "$MAX_POLLS"); do
  state=$(gh api "repos/$REPO/commits/$head_sha/status" \
    --jq '.statuses[] | select(.context == "CodeRabbit") | .state' 2>/dev/null || echo "")

  if [ "$state" = "success" ]; then
    echo "[$(date +%H:%M:%S)] Review complete."
    echo ""
    # Print the summary comment verdict
    gh pr view "$PR" --comments --json comments \
      --jq '.comments[] | select(.body | contains("summarize by coderabbit")) | .body' \
      | head -5
    exit 0
  elif [ "$state" = "pending" ]; then
    echo "[$(date +%H:%M:%S)] Poll $i/$MAX_POLLS — review in progress..."
  else
    echo "[$(date +%H:%M:%S)] Poll $i/$MAX_POLLS — no CodeRabbit status yet..."
  fi

  sleep "$INTERVAL"
done

echo "[$(date +%H:%M:%S)] Timed out after $MAX_POLLS polls."
exit 1
