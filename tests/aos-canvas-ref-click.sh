#!/usr/bin/env bash
# Smoke test: click an AOS-owned canvas semantic target by data-aos-ref.
# Uses the shared repo daemon; serialize with other live canvas tests.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

source tests/lib/live-canvas-serial.sh

CANVAS_ID="canvas-ref-click-$$"
DW_CANVAS_ID="${CANVAS_ID}-dw"
ARTIFACT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aos-canvas-ref-click.XXXXXX")"
HTML_PATH="$ARTIFACT_DIR/canvas.html"
PNG_PATH="$ARTIFACT_DIR/capture.png"

cleanup() {
  ./aos show remove --id "$CANVAS_ID" >/dev/null 2>&1 || true
  ./aos show remove --id "$DW_CANVAS_ID" >/dev/null 2>&1 || true
  rm -rf "$ARTIFACT_DIR"
  aos_live_canvas_release_serial_lock
}
trap cleanup EXIT

aos_live_canvas_acquire_serial_lock "tests/aos-canvas-ref-click.sh"

if [ "${AOS_BYPASS_PREFLIGHT:-}" = "1" ]; then
  echo "WARN: skipping AOS readiness gate because AOS_BYPASS_PREFLIGHT=1" >&2
elif ! ./aos ready >/dev/null 2>&1; then
  echo "SKIP: AOS runtime is not ready"
  exit 0
fi

cat > "$HTML_PATH" <<'HTML'
<!doctype html>
<html>
  <body style="margin:0;background:rgba(20,24,28,0.98);font:14px -apple-system,BlinkMacSystemFont,sans-serif;color:white">
    <button
      id="primary"
      data-aos-ref="contract.primary"
      data-aos-action="commit"
      data-aos-surface="canvas-ref-click-test"
      data-semantic-target-id="primary"
      aria-label="Primary Action"
      onclick="document.body.dataset.clicked = String(Number(document.body.dataset.clicked || '0') + 1); this.textContent = 'Clicked';"
      style="position:absolute;left:24px;top:32px;width:112px;height:48px"
    >Ready</button>
    <button
      id="disabled"
      data-aos-ref="contract.disabled"
      data-semantic-target-id="disabled"
      aria-label="Disabled Action"
      disabled
      style="position:absolute;left:24px;top:92px;width:112px;height:40px"
    >Disabled</button>
  </body>
</html>
HTML

./aos show create \
  --id "$CANVAS_ID" \
  --at 120,120,260,170 \
  --interactive \
  --focus \
  --file "$HTML_PATH" \
  >/dev/null

sleep 0.6

CAPTURE="$(./aos see capture --canvas "$CANVAS_ID" --xray --out "$PNG_PATH" 2>/dev/null)"
STATE_ID="$(printf '%s' "$CAPTURE" | jq -r '.state_id')"

printf '%s' "$CAPTURE" | jq -e --arg canvas "$CANVAS_ID" '
  .semantic_targets
  | map(select(
      .provenance.canvas_id == $canvas
      and .ref == "contract.primary"
      and .provenance.do_target == ("canvas:" + $canvas + "/contract.primary")
      and .enabled == true
      and (.actions | index("commit"))
      and .extension.dom_id == "primary"
      and (.provenance.bounds.width | type == "number")
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
' >/dev/null

DO_TARGET="$(printf '%s' "$CAPTURE" | jq -r --arg canvas "$CANVAS_ID" '
  .semantic_targets
  | map(select(.provenance.canvas_id == $canvas and .ref == "contract.primary" and .enabled == true))
  | if length == 1 then .[0].provenance.do_target else empty end
')"
if [ "$DO_TARGET" != "canvas:${CANVAS_ID}/contract.primary" ]; then
  echo "FAIL: expected do_target canvas:${CANVAS_ID}/contract.primary, got '$DO_TARGET'" >&2
  exit 1
fi

DRY_RUN="$(./aos do click "$DO_TARGET" --dry-run --state-id "$STATE_ID")"
printf '%s' "$DRY_RUN" | jq -e --arg canvas "$CANVAS_ID" --arg state "$STATE_ID" '
  .status == "dry_run"
  and .backend == "cgevent"
  and .execution.strategy == "dry_run_canvas_ref_click"
  and .execution.fallback_used == false
  and .execution.state_id == $state
  and .target.target_dialect == "canvas"
  and .target.canvas_id == $canvas
  and .target.ref == "contract.primary"
  and .target.source == "aos_semantic_targets"
  and .target.coordinate_space == "global_cg"
  and (.target.local_center.x | type == "number")
  and (.target.click.x | type == "number")
' >/dev/null

if ERR="$(./aos do click "canvas:${CANVAS_ID}/contract.missing" --dry-run --state-id "$STATE_ID" 2>&1 >/dev/null)"; then
  echo "FAIL: missing ref unexpectedly succeeded" >&2
  exit 1
else
  printf '%s' "$ERR" | jq -e '.code == "REF_NOT_FOUND"' >/dev/null
fi

if ERR="$(./aos do click "canvas:${CANVAS_ID}/contract.disabled" --dry-run --state-id "$STATE_ID" 2>&1 >/dev/null)"; then
  echo "FAIL: disabled ref unexpectedly succeeded" >&2
  exit 1
else
  printf '%s' "$ERR" | jq -e '.code == "TARGET_DISABLED"' >/dev/null
fi

./aos show create \
  --id "$DW_CANVAS_ID" \
  --surface desktop-world \
  --html '<!doctype html><button data-aos-ref="contract.segmented">Segmented</button>' \
  >/dev/null

if ERR="$(./aos do click "canvas:${DW_CANVAS_ID}/contract.segmented" --dry-run --state-id "$STATE_ID" 2>&1 >/dev/null)"; then
  echo "FAIL: segmented canvas ref unexpectedly succeeded" >&2
  exit 1
else
  printf '%s' "$ERR" | jq -e '.code == "UNSUPPORTED_SURFACE"' >/dev/null
fi

./aos show update --id "$CANVAS_ID" --focus >/dev/null
sleep 0.1
./aos do click "$DO_TARGET" --state-id "$STATE_ID" >/dev/null
sleep 0.2

CLICKED="$(./aos show eval --id "$CANVAS_ID" --js 'document.body.dataset.clicked || "0"' | jq -r '.result')"
if [ "$CLICKED" != "1" ]; then
  echo "FAIL: expected click count 1, got '$CLICKED'" >&2
  exit 1
fi

echo "PASS"
