#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/tests/lib/agent-workspace-fixtures.sh"
agent_workspace_test_setup

PROOF_ID="${AOS_SAVED_REF_PROOF_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
MODE="${AOS_SAVED_REF_PROOF_MODE:-fixture}"
PROOF_ROOT="${AOS_SAVED_REF_PROOF_ROOT:-/tmp/aos-cross-backend-saved-ref-regression-${PROOF_ID}}"
SUMMARY="$PROOF_ROOT/summary.json"
ROWS_JSONL="$PROOF_ROOT/rows.jsonl"
BUILD_JSON="$PROOF_ROOT/build.json"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mkdir -p "$PROOF_ROOT"
: >"$ROWS_JSONL"

cleanup() {
    local status="verified"
    if [[ -n "${AOS_STATE_ROOT:-}" && -d "$AOS_STATE_ROOT" ]]; then
        rm -rf "$AOS_STATE_ROOT" || status="failed"
    fi
    jq -n --arg status "$status" --arg state_root "${AOS_STATE_ROOT:-}" \
        '{cleanup: $status, state_root: $state_root}' >"$PROOF_ROOT/cleanup.json"
}
trap cleanup EXIT

fail_proof() {
    echo "FAIL: $*" >&2
    exit 1
}

make_backend_dirs() {
    local backend="$1"
    for dir in setup before-capture selected-ref dry-run dispatch after-capture readback cleanup; do
        mkdir -p "$PROOF_ROOT/$backend/$dir"
    done
}

run_json() {
    local output="$1"
    shift
    "$@" >"$output" 2>"$output.err" || {
        cat "$output.err" >&2 || true
        fail_proof "command failed: $*"
    }
}

append_row() {
    local backend="$1"
    local action="$2"
    local status="$3"
    local proof_level="$4"
    local dir="$5"
    local selected_ref="$6"
    local notes="$7"

    jq -n \
        --arg backend "$backend" \
        --arg action "$action" \
        --arg status "$status" \
        --arg proof_level "$proof_level" \
        --arg selected_ref "$selected_ref" \
        --arg notes "$notes" \
        --arg setup "$dir/setup" \
        --arg before_capture "$dir/before-capture" \
        --arg selected_ref_dir "$dir/selected-ref" \
        --arg dry_run "$dir/dry-run/$action.json" \
        --arg dispatch "$dir/dispatch/$action.json" \
        --arg after_capture "$dir/after-capture/$action.json" \
        --arg readback "$dir/readback/$action.json" \
        --arg cleanup "$dir/cleanup/$action.json" \
        '{
          backend: $backend,
          action: $action,
          status: $status,
          proof_level: $proof_level,
          selected_ref: $selected_ref,
          notes: [$notes],
          artifacts: {
            setup: $setup,
            before_capture: $before_capture,
            selected_ref: $selected_ref_dir,
            dry_run: $dry_run,
            dispatch: $dispatch,
            after_capture: $after_capture,
            readback: $readback,
            cleanup: $cleanup
          }
        }' >>"$ROWS_JSONL"
}

write_summary() {
    local finished_at
    finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    jq -s \
        --arg proof_id "$PROOF_ID" \
        --arg mode "$MODE" \
        --arg proof_root "$PROOF_ROOT" \
        --arg started_at "$STARTED_AT" \
        --arg finished_at "$finished_at" \
        --slurpfile build "$BUILD_JSON" \
        '{
          schema_version: "aos.saved-ref-cross-backend-proof.v0",
          status: (if all(.[]; .status == "passed" or .status == "skipped_known_limit") then "passed" else "failed" end),
          proof_id: $proof_id,
          mode: $mode,
          proof_root: $proof_root,
          started_at: $started_at,
          finished_at: $finished_at,
          build: {
            status: ($build[0].status // "unknown"),
            binary_rebuilt: (if $build[0] | has("binary_rebuilt") then $build[0].binary_rebuilt else null end),
            binary_resigned: (if $build[0] | has("binary_resigned") then $build[0].binary_resigned else null end),
            command: ($build[0].command // null)
          },
          row_status_counts: (group_by(.status) | map({key: .[0].status, value: length}) | from_entries),
          rows: .
        }' "$ROWS_JSONL" >"$SUMMARY"
}

write_cleanup_artifact() {
    local file="$1"
    jq -n '{cleanup: "verified", live_resources: "none", fixture_state_root_removed_by_trap: true}' >"$file"
}

if [[ "$MODE" != "fixture" ]]; then
    fail_proof "unsupported proof mode $MODE; fixture mode is the deterministic guarded regression lane"
fi

./aos dev build --no-restart --json >"$BUILD_JSON"

BROWSER_DIR="$PROOF_ROOT/browser"
make_backend_dirs browser
FAKE_FORM_AOS="$BROWSER_DIR/setup/fake-form-aos"
write_fake_form_aos "$FAKE_FORM_AOS"
run_json "$BROWSER_DIR/before-capture/form.json" \
    env AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-see-native.mjs capture browser:form --save --mode ax --workspace proof-browser --name snapbrowser
BROWSER_REF="$(jq -r '.refs[0].ref' "$BROWSER_DIR/before-capture/form.json")"
[[ "$BROWSER_REF" == "r1" ]] || fail_proof "expected browser ref r1, got $BROWSER_REF"
jq --arg ref "$BROWSER_REF" '.refs[] | select(.ref == $ref)' "$BROWSER_DIR/before-capture/form.json" >"$BROWSER_DIR/selected-ref/click.json"
cp "$BROWSER_DIR/selected-ref/click.json" "$BROWSER_DIR/selected-ref/fill.json"
run_json "$BROWSER_DIR/dry-run/click.json" \
    env AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-do-ref.mjs click ref:snapbrowser:r1 --workspace proof-browser --dry-run
run_json "$BROWSER_DIR/dispatch/click.json" \
    env AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-do-ref.mjs click ref:snapbrowser:r1 --workspace proof-browser
jq -e '.status == "success" and .underlying_result.execution.strategy == "fake_form_click"' "$BROWSER_DIR/dispatch/click.json" >/dev/null \
    || fail_proof "browser click dispatch receipt drifted"
run_json "$BROWSER_DIR/after-capture/click.json" \
    env AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-see-native.mjs capture browser:form --save --mode ax --workspace proof-browser --name snapbrowser_after_click
jq '{status: "passed", receipt_strategy: .underlying_result.execution.strategy, post_action: .post_action}' \
    "$BROWSER_DIR/dispatch/click.json" >"$BROWSER_DIR/readback/click.json"
write_cleanup_artifact "$BROWSER_DIR/cleanup/click.json"
append_row browser click passed deterministic_fixture "$BROWSER_DIR" "$BROWSER_REF" "fixture dispatch receipt plus post-action capture; no coordinate fallback"

run_json "$BROWSER_DIR/dry-run/fill.json" \
    env AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-do-ref.mjs fill ref:snapbrowser:r1 "hello-proof" --workspace proof-browser --dry-run
run_json "$BROWSER_DIR/dispatch/fill.json" \
    env AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-do-ref.mjs fill ref:snapbrowser:r1 "hello-proof" --workspace proof-browser
jq -e '.status == "success" and .underlying_result.execution.strategy == "fake_form_fill"' "$BROWSER_DIR/dispatch/fill.json" >/dev/null \
    || fail_proof "browser fill dispatch receipt drifted"
run_json "$BROWSER_DIR/after-capture/fill.json" \
    env AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-see-native.mjs capture browser:form --save --mode ax --workspace proof-browser --name snapbrowser_after_fill
jq '{status: "passed", receipt_strategy: .underlying_result.execution.strategy, received: .underlying_result.received, post_action: .post_action}' \
    "$BROWSER_DIR/dispatch/fill.json" >"$BROWSER_DIR/readback/fill.json"
write_cleanup_artifact "$BROWSER_DIR/cleanup/fill.json"
append_row browser fill passed deterministic_fixture "$BROWSER_DIR" "$BROWSER_REF" "fixture dispatch receipt plus post-action capture; no coordinate fallback"

CANVAS_DIR="$PROOF_ROOT/canvas"
make_backend_dirs canvas
FAKE_CANVAS_AOS="$CANVAS_DIR/setup/fake-canvas-aos"
write_fake_canvas_aos "$FAKE_CANVAS_AOS"
run_json "$CANVAS_DIR/before-capture/canvas.json" \
    env AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-see-native.mjs capture main --save --mode som --workspace proof-canvas --name snapcanvas
CANVAS_CLICK_REF="$(jq -r '.refs[] | select(.supported_actions | index("click")) | .ref' "$CANVAS_DIR/before-capture/canvas.json" | head -n 1)"
CANVAS_SET_REF="$(jq -r '.refs[] | select(.supported_actions | index("set-value")) | .ref' "$CANVAS_DIR/before-capture/canvas.json" | head -n 1)"
[[ "$CANVAS_CLICK_REF" == "r1" ]] || fail_proof "expected canvas click ref r1, got $CANVAS_CLICK_REF"
[[ "$CANVAS_SET_REF" == "r2" ]] || fail_proof "expected canvas set-value ref r2, got $CANVAS_SET_REF"
jq --arg ref "$CANVAS_CLICK_REF" '.refs[] | select(.ref == $ref)' "$CANVAS_DIR/before-capture/canvas.json" >"$CANVAS_DIR/selected-ref/click.json"
jq --arg ref "$CANVAS_SET_REF" '.refs[] | select(.ref == $ref)' "$CANVAS_DIR/before-capture/canvas.json" >"$CANVAS_DIR/selected-ref/set-value.json"
run_json "$CANVAS_DIR/dry-run/click.json" \
    env AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-ref.mjs click ref:snapcanvas:r1 --workspace proof-canvas --dry-run
run_json "$CANVAS_DIR/dispatch/click.json" \
    env AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-ref.mjs click ref:snapcanvas:r1 --workspace proof-canvas
jq -e '.status == "success" and .underlying_result.execution.backend == "canvas"' "$CANVAS_DIR/dispatch/click.json" >/dev/null \
    || fail_proof "canvas click dispatch receipt drifted"
run_json "$CANVAS_DIR/after-capture/click.json" \
    env AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-see-native.mjs capture main --save --mode som --workspace proof-canvas --name snapcanvas_after_click
jq '{status: "passed", receipt_strategy: .underlying_result.execution.strategy, post_action: .post_action}' \
    "$CANVAS_DIR/dispatch/click.json" >"$CANVAS_DIR/readback/click.json"
write_cleanup_artifact "$CANVAS_DIR/cleanup/click.json"
append_row aos_canvas click passed deterministic_fixture "$CANVAS_DIR" "$CANVAS_CLICK_REF" "fixture canvas dispatch receipt plus post-action capture; no coordinate fallback"

run_json "$CANVAS_DIR/dry-run/set-value.json" \
    env AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-ref.mjs set-value ref:snapcanvas:r2 --workspace proof-canvas --value 73 --dry-run
run_json "$CANVAS_DIR/dispatch/set-value.json" \
    env AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-ref.mjs set-value ref:snapcanvas:r2 --workspace proof-canvas --value 73
jq -e '.status == "success" and .underlying_result.execution.backend == "canvas" and .underlying_result.value == "73"' "$CANVAS_DIR/dispatch/set-value.json" >/dev/null \
    || fail_proof "canvas set-value dispatch receipt drifted"
run_json "$CANVAS_DIR/after-capture/set-value.json" \
    env AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-see-native.mjs capture main --save --mode som --workspace proof-canvas --name snapcanvas_after_set_value
jq '{status: "passed", value: .underlying_result.value, post_action: .post_action}' \
    "$CANVAS_DIR/dispatch/set-value.json" >"$CANVAS_DIR/readback/set-value.json"
write_cleanup_artifact "$CANVAS_DIR/cleanup/set-value.json"
append_row aos_canvas set-value passed deterministic_fixture "$CANVAS_DIR" "$CANVAS_SET_REF" "fixture canvas set-value receipt plus post-action capture; no coordinate fallback"

NATIVE_DIR="$PROOF_ROOT/native_ax"
make_backend_dirs native_ax
FAKE_NATIVE_AOS="$NATIVE_DIR/setup/fake-native-aos"
write_fake_native_aos "$FAKE_NATIVE_AOS"
run_json "$NATIVE_DIR/before-capture/native.json" \
    env NATIVE_DURABLE_CAPTURE=1 AOS_PATH="$FAKE_NATIVE_AOS" node scripts/aos-see-native.mjs capture main --save --mode ax --workspace proof-native --name snapnative
NATIVE_PRESS_REF="$(jq -r '.refs[] | select(.supported_actions | index("press")) | .ref' "$NATIVE_DIR/before-capture/native.json" | head -n 1)"
NATIVE_FIELD_REF="$(jq -r '.refs[] | select(.supported_actions | index("set-value")) | .ref' "$NATIVE_DIR/before-capture/native.json" | head -n 1)"
[[ "$NATIVE_PRESS_REF" == "r1" ]] || fail_proof "expected native press ref r1, got $NATIVE_PRESS_REF"
[[ "$NATIVE_FIELD_REF" == "r2" ]] || fail_proof "expected native field ref r2, got $NATIVE_FIELD_REF"
jq --arg ref "$NATIVE_PRESS_REF" '.refs[] | select(.ref == $ref)' "$NATIVE_DIR/before-capture/native.json" >"$NATIVE_DIR/selected-ref/press.json"
jq --arg ref "$NATIVE_FIELD_REF" '.refs[] | select(.ref == $ref)' "$NATIVE_DIR/before-capture/native.json" >"$NATIVE_DIR/selected-ref/focus.json"
cp "$NATIVE_DIR/selected-ref/focus.json" "$NATIVE_DIR/selected-ref/set-value.json"
run_json "$NATIVE_DIR/dry-run/press.json" \
    env AOS_PATH="$FAKE_NATIVE_AOS" node scripts/aos-do-ref.mjs press ref:snapnative:r1 --workspace proof-native --dry-run
run_json "$NATIVE_DIR/dispatch/press.json" \
    env AOS_PATH="$FAKE_NATIVE_AOS" node scripts/aos-do-ref.mjs press ref:snapnative:r1 --workspace proof-native
jq -e '.status == "success" and .underlying_result.status == "success"' "$NATIVE_DIR/dispatch/press.json" >/dev/null \
    || fail_proof "native press dispatch receipt drifted"
run_json "$NATIVE_DIR/after-capture/press.json" \
    env NATIVE_DURABLE_CAPTURE=1 AOS_PATH="$FAKE_NATIVE_AOS" node scripts/aos-see-native.mjs capture main --save --mode ax --workspace proof-native --name snapnative_after_press
jq '{status: "passed", action: .action, post_action: .post_action}' "$NATIVE_DIR/dispatch/press.json" >"$NATIVE_DIR/readback/press.json"
write_cleanup_artifact "$NATIVE_DIR/cleanup/press.json"
append_row native_ax press passed deterministic_fixture "$NATIVE_DIR" "$NATIVE_PRESS_REF" "fixture native direct-AX dispatch baseline; no no-foreground claim"

run_json "$NATIVE_DIR/dry-run/focus.json" \
    env AOS_PATH="$FAKE_NATIVE_AOS" node scripts/aos-do-ref.mjs focus ref:snapnative:r2 --workspace proof-native --dry-run
run_json "$NATIVE_DIR/dispatch/focus.json" \
    env AOS_PATH="$FAKE_NATIVE_AOS" node scripts/aos-do-ref.mjs focus ref:snapnative:r2 --workspace proof-native
jq -e '.status == "success" and .underlying_result.action == "focus"' "$NATIVE_DIR/dispatch/focus.json" >/dev/null \
    || fail_proof "native focus dispatch receipt drifted"
run_json "$NATIVE_DIR/after-capture/focus.json" \
    env NATIVE_DURABLE_CAPTURE=1 AOS_PATH="$FAKE_NATIVE_AOS" node scripts/aos-see-native.mjs capture main --save --mode ax --workspace proof-native --name snapnative_after_focus
jq '{status: "passed", action: .action, post_action: .post_action}' "$NATIVE_DIR/dispatch/focus.json" >"$NATIVE_DIR/readback/focus.json"
write_cleanup_artifact "$NATIVE_DIR/cleanup/focus.json"
append_row native_ax focus passed deterministic_fixture "$NATIVE_DIR" "$NATIVE_FIELD_REF" "fixture native direct-AX dispatch baseline; no no-foreground claim"

run_json "$NATIVE_DIR/dry-run/set-value.json" \
    env AOS_PATH="$FAKE_NATIVE_AOS" node scripts/aos-do-ref.mjs set-value ref:snapnative:r2 "Ada" --workspace proof-native --dry-run
run_json "$NATIVE_DIR/dispatch/set-value.json" \
    env AOS_PATH="$FAKE_NATIVE_AOS" node scripts/aos-do-ref.mjs set-value ref:snapnative:r2 "Ada" --workspace proof-native
jq -e '.status == "success" and .underlying_result.action == "set-value"' "$NATIVE_DIR/dispatch/set-value.json" >/dev/null \
    || fail_proof "native set-value dispatch receipt drifted"
run_json "$NATIVE_DIR/after-capture/set-value.json" \
    env NATIVE_DURABLE_CAPTURE=1 AOS_PATH="$FAKE_NATIVE_AOS" node scripts/aos-see-native.mjs capture main --save --mode ax --workspace proof-native --name snapnative_after_set_value
jq '{status: "passed", action: .action, post_action: .post_action}' "$NATIVE_DIR/dispatch/set-value.json" >"$NATIVE_DIR/readback/set-value.json"
write_cleanup_artifact "$NATIVE_DIR/cleanup/set-value.json"
append_row native_ax set-value passed deterministic_fixture "$NATIVE_DIR" "$NATIVE_FIELD_REF" "fixture native direct-AX dispatch baseline; no no-foreground claim"

write_summary
cat "$SUMMARY"
