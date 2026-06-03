#!/usr/bin/env bash
# Smoke test: target-addressed AOS canvas actions for toolkit panel drag handles
# and single-thumb toolkit sliders.
# Uses the shared repo daemon; serialize with other live canvas tests.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

source tests/lib/live-canvas-serial.sh

CANVAS_ID="canvas-ref-actions-$$"
ARTIFACT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aos-canvas-ref-actions.XXXXXX")"
HTML_PATH="$ARTIFACT_DIR/canvas.html"
PNG_PATH="$ARTIFACT_DIR/capture.png"

cleanup() {
  ./aos show remove --id "$CANVAS_ID" >/dev/null 2>&1 || true
  rm -rf "$ARTIFACT_DIR"
  aos_live_canvas_release_serial_lock
}
trap cleanup EXIT

aos_live_canvas_acquire_serial_lock "tests/aos-canvas-ref-actions.sh"

if [ "${AOS_BYPASS_PREFLIGHT:-}" = "1" ]; then
  echo "WARN: skipping AOS readiness gate because AOS_BYPASS_PREFLIGHT=1" >&2
elif ! ./aos ready --post-permission >/dev/null 2>&1; then
  echo "SKIP: AOS runtime is not ready"
  exit 0
fi

cat > "$HTML_PATH" <<'HTML'
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <link rel="stylesheet" href="aos://toolkit/panel/defaults.css">
    <link rel="stylesheet" href="aos://toolkit/controls/defaults.css">
  </head>
  <body style="margin:0;background:rgba(20,24,28,0.98);color:white">
    <section id="root" style="width:100vw;height:100vh"></section>
    <script type="module">
      import { mountChrome } from 'aos://toolkit/panel/chrome.js'
      import { createSlider } from 'aos://toolkit/controls/index.js'

      window.__aosCanvasId = 'CANVAS_ID_PLACEHOLDER'
      const chrome = mountChrome(document.getElementById('root'), {
        title: 'Action Contract',
        draggable: true,
        minimize: false,
        close: false,
      })
      const slider = createSlider({
        id: 'opacity',
        surface: 'action-contract',
        label: 'Opacity',
        value: 0.25,
        min: 0,
        max: 1,
        step: 0.05,
      })
      slider.el.style.margin = '24px'
      chrome.contentEl.append(slider.el)
      window.__aosActionContractSlider = slider
    </script>
  </body>
</html>
HTML

python3 - "$HTML_PATH" "$CANVAS_ID" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
path.write_text(path.read_text().replace("CANVAS_ID_PLACEHOLDER", sys.argv[2]))
PY

./aos show create \
  --id "$CANVAS_ID" \
  --at 120,120,360,220 \
  --interactive \
  --focus \
  --file "$HTML_PATH" \
  >/dev/null

sleep 0.8

CAPTURE="$(./aos see capture --canvas "$CANVAS_ID" --xray --out "$PNG_PATH" 2>/dev/null)"
STATE_ID="$(printf '%s' "$CAPTURE" | jq -r '.state_id')"

SLIDER_TARGET="$(printf '%s' "$CAPTURE" | jq -r --arg canvas "$CANVAS_ID" '
  .semantic_targets
  | map(select(
      .canvas_id == $canvas
      and .ref == "action-contract:opacity"
      and .role == "slider"
      and (.actions | index("set-value"))
      and (.actions | index("drag"))
      and .state.min == 0
      and .state.max == 1
      and .state.step == 0.05
      and .state.thumb_count == 1
      and (.geometry.control_bounds.width | type == "number")
    ))
  | if length == 1 then .[0].do_target else empty end
')"

if [ "$SLIDER_TARGET" != "canvas:${CANVAS_ID}/action-contract:opacity" ]; then
  echo "FAIL: expected slider semantic target, got '$SLIDER_TARGET'" >&2
  echo "$CAPTURE" | jq '.semantic_targets' >&2
  exit 1
fi

DRAG_TARGET="$(printf '%s' "$CAPTURE" | jq -r --arg canvas "$CANVAS_ID" '
  .semantic_targets
  | map(select(
      .canvas_id == $canvas
      and .ref == ($canvas + ":drag-handle")
      and .id == "drag-handle"
      and (.actions | index("drag"))
    ))
  | if length == 1 then .[0].do_target else empty end
')"

if [ "$DRAG_TARGET" != "canvas:${CANVAS_ID}/${CANVAS_ID}:drag-handle" ]; then
  echo "FAIL: expected panel drag semantic target, got '$DRAG_TARGET'" >&2
  echo "$CAPTURE" | jq '.semantic_targets' >&2
  exit 1
fi

SET_OUT="$(./aos do set-value "$SLIDER_TARGET" 0.7 --state-id "$STATE_ID")"
printf '%s' "$SET_OUT" | jq -e --arg canvas "$CANVAS_ID" --arg state "$STATE_ID" '
  .status == "success"
  and .action == "set-value"
  and .backend == "canvas"
  and .playback == "immediate"
  and .execution.strategy == "canvas_semantic_set_value"
  and .execution.backend == "canvas"
  and .execution.fallback_used == false
  and .execution.state_id == $state
  and .target.canvas_id == $canvas
  and .post_target.state.value == "0.7"
' >/dev/null

VALUE="$(./aos show eval --id "$CANVAS_ID" --js 'String(window.__aosActionContractSlider.getValue())' | jq -r '.result')"
if [ "$VALUE" != "0.7" ]; then
  echo "FAIL: expected slider value 0.7, got '$VALUE'" >&2
  exit 1
fi

DRY_RUN="$(./aos do drag "$DRAG_TARGET" --by 80,40 --dry-run --state-id "$STATE_ID")"
printf '%s' "$DRY_RUN" | jq -e --arg canvas "$CANVAS_ID" --arg state "$STATE_ID" '
  .status == "dry_run"
  and .action == "drag"
  and .backend == "canvas"
  and .playback == "immediate"
  and .execution.strategy == "dry_run_canvas_semantic_drag_by"
  and .execution.state_id == $state
  and .target.canvas_id == $canvas
  and .target.ref == ($canvas + ":drag-handle")
' >/dev/null

echo "PASS"
