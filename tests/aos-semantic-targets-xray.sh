#!/usr/bin/env bash
# Smoke test: AOS-owned canvas xray includes fixed semantic target projection
# from standard DOM/ARIA plus thin AOS data attributes.
# Uses the shared repo daemon; serialize with other live canvas tests.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

source tests/lib/live-canvas-serial.sh

CANVAS_ID="semantic-target-smoke-$$"

cleanup() {
  ./aos show remove --id "$CANVAS_ID" >/dev/null 2>&1 || true
  rm -f "/tmp/${CANVAS_ID}.png"
  aos_live_canvas_release_serial_lock
}
trap cleanup EXIT

aos_live_canvas_acquire_serial_lock "tests/aos-semantic-targets-xray.sh"

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
      .provenance.canvas_id == $canvas
      and .ref == "contract.primary"
      and .extension.dom_id == "primary"
      and .provenance.do_target == ("canvas:" + $canvas + "/contract.primary")
      and .role == "button"
      and .name == "Primary Action"
      and (.actions | index("commit"))
      and .surface == "contract.surface"
      and .provenance.parent_canvas_id == "contract-parent"
      and .enabled == true
      and .state.pressed == true
      and (.provenance.bounds.width | type == "number")
      and .provenance.bounds.width > 0
      and (.provenance.frame.width | type == "number")
      and (.provenance.center.x | type == "number")
      and (has("id") | not)
      and (has("canvas_id") | not)
      and (has("do_target") | not)
      and (has("action") | not)
      and (has("parent_canvas") | not)
      and (has("bounds") | not)
      and (has("center") | not)
      and (has("target_id") | not)
      and (has("aos_ref") | not)
      and (has("data_aos_ref") | not)
    ))
  | length == 1
' >/dev/null || {
  echo "FAIL: expected semantic_targets entry not found" >&2
  echo "$OUT" | jq '.semantic_targets' >&2
  exit 1
}

echo "PASS"
