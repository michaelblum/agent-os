#!/usr/bin/env bash
# Regression test: canvas xray retries an empty semantic target read before
# concluding that an interactive surface has no targets.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CANVAS_ID="semantic-target-retry-$$"

cleanup() {
  ./aos show remove --id "$CANVAS_ID" >/dev/null 2>&1 || true
  rm -f "/tmp/${CANVAS_ID}.png"
}
trap cleanup EXIT

./aos show create \
  --id "$CANVAS_ID" \
  --at 80,80,240,140 \
  --interactive \
  --html '<!doctype html><html><body style="margin:0;background:transparent"><button id="retry-button" data-aos-ref="contract.retry" data-aos-action="retry" data-aos-surface="contract.surface" data-semantic-target-id="retry" aria-label="Retry Action" style="position:absolute;left:20px;top:30px;width:90px;height:44px"></button><script>const originalQuerySelectorAll = document.querySelectorAll.bind(document); let semanticQueries = 0; document.querySelectorAll = (selector) => { if (String(selector).includes("[data-semantic-target-id]")) { semanticQueries += 1; if (semanticQueries === 1) return []; } return originalQuerySelectorAll(selector); };</script></body></html>' \
  >/dev/null

sleep 0.4

OUT="$(./aos see capture --canvas "$CANVAS_ID" --xray --out "/tmp/${CANVAS_ID}.png" 2>/dev/null)"

echo "$OUT" | jq -e --arg canvas "$CANVAS_ID" '
  .semantic_targets
  | map(select(
      .canvas_id == $canvas
      and .id == "retry"
      and .ref == "contract.retry"
      and .role == "button"
      and .name == "Retry Action"
      and .action == "retry"
      and .surface == "contract.surface"
      and .enabled == true
    ))
  | length == 1
' >/dev/null || {
  echo "FAIL: expected semantic_targets retry entry not found" >&2
  echo "$OUT" | jq '.semantic_targets' >&2
  exit 1
}

echo "PASS"
