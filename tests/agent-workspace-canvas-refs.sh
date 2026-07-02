#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tests/lib/agent-workspace-fixtures.sh"
agent_workspace_test_setup

FAKE_CANVAS_AOS="$TMP_DIR/fake-canvas-aos"
write_fake_canvas_aos "$FAKE_CANVAS_AOS"

CANVAS="$TMP_DIR/capture-canvas.json"
AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-see-native.mjs capture main --save --mode som --workspace ws-canvas --name snapcanvas >"$CANVAS"
jq -e '
  .status == "success"
  and .capture_mode == "som"
  and .workspace_id == "ws-canvas"
  and .snapshot_id == "snapcanvas"
  and .state_id == "see_canvas_fixture"
  and .refs[0].backend == "aos_canvas"
  and .refs[0].resolution_class == "reacquirable"
  and .refs[0].confidence == "high"
  and .refs[0].action_target == "canvas:canvas-fixture/save-button"
  and (.refs[0].supported_actions | index("click") != null)
  and (.refs[0].supported_actions | index("focus") | not)
  and .refs[1].action_target == "canvas:canvas-fixture/brightness-slider"
  and (.refs[1].supported_actions | index("set-value") != null)
  and (.refs[1].supported_actions | index("focus") | not)
' "$CANVAS" >/dev/null || fail "AOS canvas saved-ref reporting drifted: $(cat "$CANVAS")"

CANVAS_DRY="$TMP_DIR/do-canvas-dry-run.json"
AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-native.mjs click ref:snapcanvas:r1 --workspace ws-canvas --dry-run >"$CANVAS_DRY"
jq -e '
  .status == "dry_run"
  and .ref.backend == "aos_canvas"
  and .ref.resolution_class == "reacquirable"
  and .resolved_action.resolution_status == "resolved"
  and (.resolved_action.command | index("canvas:canvas-fixture/save-button") != null)
  and (.resolved_action.command | index("--state-id") != null)
  and (.resolved_action.command | index("see_canvas_fixture") != null)
' "$CANVAS_DRY" >/dev/null || fail "AOS canvas ref dry-run drifted: $(cat "$CANVAS_DRY")"

CANVAS_ACTION="$TMP_DIR/do-canvas-action.json"
AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-native.mjs click ref:snapcanvas:r1 --workspace ws-canvas >"$CANVAS_ACTION"
jq -e '
  .status == "success"
  and .execution.backend == "canvas"
  and .execution.state_id == "see_canvas_fixture"
  and (.received | index("canvas:canvas-fixture/save-button") != null)
' "$CANVAS_ACTION" >/dev/null || fail "AOS canvas ref action drifted: $(cat "$CANVAS_ACTION")"

CANVAS_SET_DRY="$TMP_DIR/do-canvas-set-value-dry-run.json"
AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-native.mjs set-value ref:snapcanvas:r2 --workspace ws-canvas --value 42 --dry-run >"$CANVAS_SET_DRY"
jq -e '
  .status == "dry_run"
  and .action == "set-value"
  and .ref.backend == "aos_canvas"
  and .ref.resolution_class == "reacquirable"
  and .resolved_action.resolution_status == "resolved"
  and (.resolved_action.command | index("canvas:canvas-fixture/brightness-slider") != null)
  and (.resolved_action.command | index("--value") != null)
  and (.resolved_action.command | index("42") != null)
  and (.resolved_action.command | index("--state-id") != null)
  and (.resolved_action.command | index("see_canvas_fixture") != null)
' "$CANVAS_SET_DRY" >/dev/null || fail "AOS canvas set-value ref dry-run drifted: $(cat "$CANVAS_SET_DRY")"

CANVAS_SET_ACTION="$TMP_DIR/do-canvas-set-value-action.json"
AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-native.mjs set-value ref:snapcanvas:r2 --workspace ws-canvas --value 43 >"$CANVAS_SET_ACTION"
jq -e '
  .status == "success"
  and .execution.backend == "canvas"
  and .execution.state_id == "see_canvas_fixture"
  and .value == "43"
  and (.received | index("canvas:canvas-fixture/brightness-slider") != null)
' "$CANVAS_SET_ACTION" >/dev/null || fail "AOS canvas set-value ref action drifted: $(cat "$CANVAS_SET_ACTION")"

CANVAS_SET_POSITIONAL="$TMP_DIR/do-canvas-set-value-positional.json"
AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-native.mjs set-value ref:snapcanvas:r2 44 --workspace ws-canvas >"$CANVAS_SET_POSITIONAL"
jq -e '
  .status == "success"
  and .value == "44"
  and (.received | index("44") != null)
' "$CANVAS_SET_POSITIONAL" >/dev/null || fail "AOS canvas positional set-value ref action drifted: $(cat "$CANVAS_SET_POSITIONAL")"

CANVAS_DIRECT_SET="$TMP_DIR/do-canvas-direct-set-value.json"
AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-native.mjs set-value canvas:canvas-fixture/brightness-slider --value 45 --dry-run >"$CANVAS_DIRECT_SET"
jq -e '
  .status == "dry_run_passthrough"
  and (.received | index("__do") != null)
  and (.received | index("set-value") != null)
  and (.received | index("canvas:canvas-fixture/brightness-slider") != null)
' "$CANVAS_DIRECT_SET" >/dev/null || fail "direct canvas set-value wrapper validation drifted: $(cat "$CANVAS_DIRECT_SET")"

CANVAS_FOCUS_ERR="$TMP_DIR/do-canvas-focus.err"
if AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-native.mjs focus ref:snapcanvas:r1 --workspace ws-canvas >"$TMP_DIR/do-canvas-focus.out" 2>"$CANVAS_FOCUS_ERR"; then
    fail "unsupported AOS canvas focus ref unexpectedly succeeded"
fi
expect_error_code "ACTION_INCOMPATIBLE" "$CANVAS_FOCUS_ERR"
jq -e '.status == "action_incompatible" and .ref.backend == "aos_canvas" and (.safe_next_action | contains("aos see capture --save"))' "$CANVAS_FOCUS_ERR" >/dev/null \
    || fail "AOS canvas focus ref did not fail closed through action matrix: $(cat "$CANVAS_FOCUS_ERR")"

CANVAS_PRESS_ERR="$TMP_DIR/do-canvas-press.err"
if AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-native.mjs press ref:snapcanvas:r1 --workspace ws-canvas >"$TMP_DIR/do-canvas-press.out" 2>"$CANVAS_PRESS_ERR"; then
    fail "unsupported AOS canvas press ref unexpectedly succeeded"
fi
expect_error_code "ACTION_INCOMPATIBLE" "$CANVAS_PRESS_ERR"
jq -e '.status == "action_incompatible" and .ref.backend == "aos_canvas"' "$CANVAS_PRESS_ERR" >/dev/null \
    || fail "AOS canvas press ref did not fail closed through action matrix: $(cat "$CANVAS_PRESS_ERR")"

CANVAS_SET_MISSING_VALUE_ERR="$TMP_DIR/do-canvas-set-value-missing.err"
if AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-native.mjs set-value ref:snapcanvas:r2 --workspace ws-canvas --dry-run >"$TMP_DIR/do-canvas-set-value-missing.out" 2>"$CANVAS_SET_MISSING_VALUE_ERR"; then
    fail "set-value saved ref without value unexpectedly succeeded"
fi
expect_error_code "MISSING_ARG" "$CANVAS_SET_MISSING_VALUE_ERR"

CANVAS_INCOMPATIBLE_ERR="$TMP_DIR/do-canvas-incompatible.err"
if AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-native.mjs type ref:snapcanvas:r1 --workspace ws-canvas >"$TMP_DIR/do-canvas-incompatible.out" 2>"$CANVAS_INCOMPATIBLE_ERR"; then
    fail "incompatible AOS canvas ref action unexpectedly succeeded"
fi
expect_error_code "UNKNOWN_FLAG" "$CANVAS_INCOMPATIBLE_ERR"

echo "PASS canvas refs"
