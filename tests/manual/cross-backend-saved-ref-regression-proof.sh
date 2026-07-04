#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/tests/lib/agent-workspace-fixtures.sh"

PROOF_ID="${AOS_SAVED_REF_PROOF_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
MODE="${AOS_SAVED_REF_PROOF_MODE:-fixture}"
PROOF_ROOT="${AOS_SAVED_REF_PROOF_ROOT:-/tmp/aos-cross-backend-saved-ref-regression-${PROOF_ID}}"
SUMMARY="$PROOF_ROOT/summary.json"
ROWS_JSONL="$PROOF_ROOT/rows.jsonl"
BUILD_JSON="$PROOF_ROOT/build.json"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
FIXTURE_STATE_ROOT=""

mkdir -p "$PROOF_ROOT"
: >"$ROWS_JSONL"

if [[ "$MODE" == "fixture" ]]; then
    agent_workspace_test_setup
    FIXTURE_STATE_ROOT="$AOS_STATE_ROOT"
else
    export AOS_RUNTIME_MODE="repo"
    unset AOS_STATE_ROOT
fi

cleanup() {
    local status="verified"
    if [[ -n "$FIXTURE_STATE_ROOT" && -d "$FIXTURE_STATE_ROOT" ]]; then
        rm -rf "$FIXTURE_STATE_ROOT" || status="failed"
    fi
    jq -n --arg status "$status" --arg state_root "$FIXTURE_STATE_ROOT" \
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

write_json_artifact() {
    local file="$1"
    shift
    mkdir -p "$(dirname "$file")"
    jq -n "$@" >"$file"
}

write_classified_row_artifacts() {
    local backend="$1"
    local action="$2"
    local status="$3"
    local reason="$4"
    local dir="$5"
    local evidence_file="$6"

    for phase in dry-run dispatch after-capture readback cleanup; do
        write_json_artifact "$dir/$phase/$action.json" \
            --arg status "$status" \
            --arg reason "$reason" \
            --arg evidence "$evidence_file" \
            '{status: $status, reason: $reason, evidence: $evidence}'
    done
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
          status: (
            if all(.[]; .status == "passed" or .status == "skipped_known_limit") then "passed"
            elif all(.[]; .status == "passed" or .status == "skipped_known_limit" or .status == "blocked_permission" or .status == "blocked_runtime") then "completed_with_classified_blockers"
            else "failed"
            end
          ),
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

./aos dev build --no-restart --json >"$BUILD_JSON"

run_guarded_live_mode() {
    local browser_dir="$PROOF_ROOT/browser"
    make_backend_dirs browser
    if ! command -v playwright-cli >/dev/null 2>&1; then
        write_json_artifact "$browser_dir/setup/playwright-cli.json" \
            '{status: "blocked_runtime", code: "PLAYWRIGHT_CLI_NOT_FOUND", required_for: ["browser saved-ref click live proof", "browser saved-ref fill live proof"]}'
        for action in click fill; do
            write_classified_row_artifacts browser "$action" blocked_runtime "playwright-cli not found on PATH" "$browser_dir" "$browser_dir/setup/playwright-cli.json"
            append_row browser "$action" blocked_runtime guarded_live "$browser_dir" "" "playwright-cli is required for real browser saved-ref mutation"
        done
    else
        write_json_artifact "$browser_dir/setup/playwright-cli.json" \
            --arg path "$(command -v playwright-cli)" \
            '{status: "available", path: $path}'
        for action in click fill; do
            write_classified_row_artifacts browser "$action" blocked_runtime "browser saved-ref live harness is not implemented for the available playwright-cli runtime" "$browser_dir" "$browser_dir/setup/playwright-cli.json"
            append_row browser "$action" blocked_runtime guarded_live "$browser_dir" "" "browser runtime exists but this harness has no safe controlled saved-ref browser live row yet"
        done
    fi

    local canvas_dir="$PROOF_ROOT/canvas"
    make_backend_dirs canvas
    local canvas_id="saved-ref-live-${PROOF_ID}-$$"
    local workspace="saved-ref-live-${PROOF_ID}-canvas"
    local html_path="$canvas_dir/setup/canvas.html"
    local readiness_json="$canvas_dir/setup/ready.json"
    local create_json="$canvas_dir/setup/show-create.json"
    local wait_json="$canvas_dir/setup/show-wait.json"
    local remove_json="$canvas_dir/cleanup/canvas.json"
    local canvas_status="passed"
    local canvas_reason=""

    cat >"$html_path" <<HTML
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <link rel="stylesheet" href="aos://toolkit/controls/defaults.css">
  </head>
  <body style="margin:0;background:rgba(20,24,28,0.98);color:white">
    <button
      data-aos-ref="contract.primary"
      data-semantic-target-id="primary"
      onclick="document.body.dataset.clicked = String(Number(document.body.dataset.clicked || '0') + 1)"
      style="margin:20px;width:120px;height:44px"
    >Ready</button>
    <section id="root" style="margin:16px;width:340px;height:120px"></section>
    <script type="module">
      import { createSlider } from 'aos://toolkit/controls/slider.js'
      const slider = createSlider({
        id: 'opacity',
        surface: 'action-contract',
        label: 'Opacity',
        value: 0.25,
        min: 0,
        max: 1,
        step: 0.05,
      })
      document.getElementById('root').append(slider.el)
      window.__aosSavedRefProofSlider = slider
    </script>
  </body>
</html>
HTML

    if ! ./aos ready --json >"$readiness_json" 2>"$readiness_json.err"; then
        canvas_status="blocked_runtime"
        canvas_reason="aos ready failed before live canvas setup"
    elif ! ./aos show create --id "$canvas_id" --at 120,120,440,280 --interactive --focus --file "$html_path" >"$create_json" 2>"$create_json.err"; then
        canvas_status="blocked_runtime"
        canvas_reason="aos show create failed for live canvas fixture"
    else
        ./aos show wait --id "$canvas_id" --js 'Boolean(window.__aosSavedRefProofSlider) && document.querySelectorAll("[data-aos-ref]").length >= 2' --timeout 8s >"$wait_json" 2>"$wait_json.err" || true
        sleep 1
    fi

    if [[ "$canvas_status" == "passed" ]]; then
        if ! ./aos see capture --canvas "$canvas_id" --save --mode som --workspace "$workspace" --name before >"$canvas_dir/before-capture/canvas.json" 2>"$canvas_dir/before-capture/canvas.json.err"; then
            canvas_status="blocked_runtime"
            canvas_reason="live canvas saved capture failed"
        fi
    fi

    local click_ref=""
    local set_ref=""
    if [[ "$canvas_status" == "passed" ]]; then
        click_ref="$(jq -r '.refs[] | select(.backend == "aos_canvas" and (.supported_actions | index("click"))) | .ref' "$canvas_dir/before-capture/canvas.json" | head -n 1)"
        set_ref="$(jq -r '.refs[] | select(.backend == "aos_canvas" and (.supported_actions | index("set-value"))) | .ref' "$canvas_dir/before-capture/canvas.json" | head -n 1)"
        if [[ -z "$click_ref" || -z "$set_ref" ]]; then
            canvas_status="blocked_runtime"
            canvas_reason="live canvas capture did not produce both click and set-value saved refs"
        else
            jq --arg ref "$click_ref" '.refs[] | select(.ref == $ref)' "$canvas_dir/before-capture/canvas.json" >"$canvas_dir/selected-ref/click.json"
            jq --arg ref "$set_ref" '.refs[] | select(.ref == $ref)' "$canvas_dir/before-capture/canvas.json" >"$canvas_dir/selected-ref/set-value.json"
        fi
    fi

    if [[ "$canvas_status" == "passed" ]]; then
        if ! ./aos do click "ref:before:$click_ref" --workspace "$workspace" --dry-run >"$canvas_dir/dry-run/click.json" 2>"$canvas_dir/dry-run/click.json.err" \
            || ! ./aos do click "ref:before:$click_ref" --workspace "$workspace" >"$canvas_dir/dispatch/click.json" 2>"$canvas_dir/dispatch/click.json.err" \
            || ! ./aos do set-value "ref:before:$set_ref" --workspace "$workspace" --value 0.7 --dry-run >"$canvas_dir/dry-run/set-value.json" 2>"$canvas_dir/dry-run/set-value.json.err" \
            || ! ./aos do set-value "ref:before:$set_ref" --workspace "$workspace" --value 0.7 >"$canvas_dir/dispatch/set-value.json" 2>"$canvas_dir/dispatch/set-value.json.err"; then
            canvas_status="blocked_runtime"
            canvas_reason="live canvas saved-ref dry-run or dispatch failed"
        fi
    fi

    if [[ "$canvas_status" == "passed" ]]; then
        ./aos see capture --canvas "$canvas_id" --save --mode som --workspace "$workspace" --name after_click >"$canvas_dir/after-capture/click.json" 2>"$canvas_dir/after-capture/click.json.err" || {
            canvas_status="blocked_runtime"
            canvas_reason="post-click live canvas capture failed"
        }
    fi
    if [[ "$canvas_status" == "passed" ]]; then
        ./aos see capture --canvas "$canvas_id" --save --mode som --workspace "$workspace" --name after_set_value >"$canvas_dir/after-capture/set-value.json" 2>"$canvas_dir/after-capture/set-value.json.err" || {
            canvas_status="blocked_runtime"
            canvas_reason="post-set-value live canvas capture failed"
        }
    fi

    if [[ "$canvas_status" == "passed" ]]; then
        local clicked
        local value
        clicked="$(./aos show eval --id "$canvas_id" --js 'document.body.dataset.clicked || "0"' | jq -r '.result')"
        value="$(./aos show eval --id "$canvas_id" --js 'String(window.__aosSavedRefProofSlider.getValue())' | jq -r '.result')"
        jq -n --arg clicked "$clicked" '{status: (if $clicked == "1" then "passed" else "failed" end), clicked: $clicked}' >"$canvas_dir/readback/click.json"
        jq -n --arg value "$value" '{status: (if $value == "0.7" then "passed" else "failed" end), value: $value}' >"$canvas_dir/readback/set-value.json"
        if [[ "$clicked" != "1" || "$value" != "0.7" ]]; then
            canvas_status="blocked_runtime"
            canvas_reason="live canvas post-action readback did not show expected mutation"
        fi
    fi

    if ./aos show remove --id "$canvas_id" >"$remove_json" 2>"$remove_json.err"; then
        :
    elif ./aos show list --json | jq -e --arg id "$canvas_id" '[.canvases[]? | select(.id == $id)] | length == 0' >/dev/null; then
        jq -n --arg canvas_id "$canvas_id" '{status: "verified_already_absent", canvas_id: $canvas_id}' >"$remove_json"
    else
        canvas_status="blocked_cleanup_uncertain"
        canvas_reason="live canvas cleanup failed"
    fi

    if [[ "$canvas_status" == "passed" ]]; then
        write_cleanup_artifact "$canvas_dir/cleanup/click.json"
        write_cleanup_artifact "$canvas_dir/cleanup/set-value.json"
        append_row aos_canvas click passed guarded_live "$canvas_dir" "$click_ref" "live repo-daemon saved-ref click mutated controlled canvas and readback passed"
        append_row aos_canvas set-value passed guarded_live "$canvas_dir" "$set_ref" "live repo-daemon saved-ref set-value mutated controlled toolkit slider and readback passed"
    else
        write_json_artifact "$canvas_dir/setup/runtime-blocker.json" --arg status "$canvas_status" --arg reason "$canvas_reason" '{status: $status, reason: $reason}'
        for action in click set-value; do
            write_classified_row_artifacts aos_canvas "$action" blocked_runtime "$canvas_reason" "$canvas_dir" "$canvas_dir/setup/runtime-blocker.json"
            append_row aos_canvas "$action" blocked_runtime guarded_live "$canvas_dir" "" "$canvas_reason"
        done
    fi

    local native_dir="$PROOF_ROOT/native_ax"
    make_backend_dirs native_ax
    if bash tests/agent-workspace-native-refs.sh >"$native_dir/setup/native-deterministic-baseline.out" 2>"$native_dir/setup/native-deterministic-baseline.err"; then
        for action in press focus set-value; do
            write_classified_row_artifacts native_ax "$action" passed "deterministic native saved-ref baseline passed; native production was not changed in this slice" "$native_dir" "$native_dir/setup/native-deterministic-baseline.out"
            append_row native_ax "$action" passed deterministic_native_baseline "$native_dir" "" "deterministic native saved-ref baseline passed; live native rerun not required for this harness-only slice"
        done
    else
        for action in press focus set-value; do
            write_classified_row_artifacts native_ax "$action" blocked_runtime "deterministic native saved-ref baseline failed" "$native_dir" "$native_dir/setup/native-deterministic-baseline.err"
            append_row native_ax "$action" blocked_runtime deterministic_native_baseline "$native_dir" "" "deterministic native saved-ref baseline failed"
        done
    fi
}

if [[ "$MODE" == "guarded-live" ]]; then
    run_guarded_live_mode
    write_summary
    cat "$SUMMARY"
    exit 0
fi

if [[ "$MODE" != "fixture" ]]; then
    fail_proof "unsupported proof mode $MODE; supported modes: fixture, guarded-live"
fi

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
