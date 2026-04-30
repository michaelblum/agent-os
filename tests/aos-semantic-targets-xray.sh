#!/usr/bin/env bash
# Smoke test: AOS-owned canvas xray includes fixed semantic target projection
# from standard DOM/ARIA plus thin AOS data attributes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CANVAS_ID="semantic-target-smoke-$$"

cleanup() {
  ./aos show remove --id "$CANVAS_ID" >/dev/null 2>&1 || true
  rm -f "/tmp/${CANVAS_ID}.png"
}
trap cleanup EXIT

./aos show create \
  --id "$CANVAS_ID" \
  --at 80,80,240,140 \
  --interactive \
  --html '<!doctype html><html><body style="margin:0;background:transparent"><button id="primary-button" data-aos-ref="contract.primary" data-aos-action="commit" data-aos-surface="contract.surface" data-semantic-target-id="primary" data-aos-parent-canvas="contract-parent" aria-label="Primary Action" aria-pressed="true" style="position:absolute;left:20px;top:30px;width:90px;height:44px"></button></body></html>' \
  >/dev/null

sleep 0.4

OUT="$(./aos see capture --canvas "$CANVAS_ID" --xray --out "/tmp/${CANVAS_ID}.png" 2>/dev/null)"

echo "$OUT" | jq -e --arg canvas "$CANVAS_ID" '
  .semantic_targets
  | map(select(
      .canvas_id == $canvas
      and .id == "primary"
      and .ref == "contract.primary"
      and .role == "button"
      and .name == "Primary Action"
      and .action == "commit"
      and .surface == "contract.surface"
      and .parent_canvas == "contract-parent"
      and .enabled == true
      and .state.pressed == true
      and (.bounds.width | type == "number")
      and .bounds.width > 0
      and (.center.x | type == "number")
    ))
  | length == 1
' >/dev/null || {
  echo "FAIL: expected semantic_targets entry not found" >&2
  echo "$OUT" | jq '.semantic_targets' >&2
  exit 1
}

echo "PASS"
