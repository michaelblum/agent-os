#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tests/lib/agent-workspace-fixtures.sh"
agent_workspace_test_setup

FAKE_CANVAS_AOS="$TMP_DIR/fake-canvas-aos"
write_fake_canvas_aos "$FAKE_CANVAS_AOS"

CANVAS="$TMP_DIR/capture-canvas.json"
AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-see-native.mjs capture main --save --mode som --workspace ws-canvas --name snapcanvas >"$CANVAS"
CANVAS_REFS_PATH="$(jq -r '.paths.refs' "$CANVAS")"
jq -e '
  .status == "success"
  and .capture_mode == "som"
  and .capture_target == "main"
  and .workspace_id == "ws-canvas"
  and .snapshot_id == "snapcanvas"
  and .state_id == "see_canvas_fixture"
  and .refs[0].backend == "aos_canvas"
  and .refs[0].capture_target == "main"
  and .refs[0].capture_mode == "som"
  and .refs[0].resolution_class == "reacquirable"
  and .refs[0].confidence == "high"
  and .refs[0].action_target == "canvas:canvas-fixture/save-button"
  and (.refs[0].supported_actions | index("click") != null)
  and .refs[0].conformance.actionability == "reacquirable_saved_ref_mutation"
  and .refs[0].conformance.validation == "current_canvas_target_resolution"
  and .refs[0].conformance.proof.level == "deterministic_contract_tests"
  and .refs[0].conformance.proof.status == "deterministic_contract_tests_passed"
  and (.refs[0].conformance.proof.evidence | index("tests/agent-workspace-canvas-refs.sh") != null)
  and (.refs[0].conformance.proof.evidence | index("tests/agent-workspace-saved-ref.sh") != null)
  and (.refs[0].conformance.proof.approval_gates | length) == 0
  and .refs[0].conformance.no_foreground.claim == "not_applicable"
  and .refs[0].conformance.target_uncertainty.status == "requires_current_resolution"
  and any(.refs[0].conformance.target_uncertainty.available_identity_facts[]; . == "reacquisition")
  and (.refs[0].supported_actions | index("focus") | not)
  and .refs[1].action_target == "canvas:canvas-fixture/brightness-slider"
  and (.refs[1].supported_actions | index("set-value") != null)
  and .refs[1].conformance.mutation == "supported_after_current_resolution"
  and (.refs[1].supported_actions | index("focus") | not)
' "$CANVAS" >/dev/null || fail "AOS canvas saved-ref reporting drifted: $(cat "$CANVAS")"

CANVAS_CURRENT_REFS="$TMP_DIR/refs-canvas-current.json"
AOS_PATH="$FAKE_CANVAS_AOS" ./aos see refs --workspace ws-canvas --query Brightness --json >"$CANVAS_CURRENT_REFS"
jq -e '
  .status == "success"
  and .schema_version == "aos.agent-workspace.v0"
  and .workspace_id == "ws-canvas"
  and .snapshot_id == "snapcanvas"
  and .query == "Brightness"
  and (.refs | length) == 1
  and .refs[0].ref == "r2"
  and .refs[0].ref_scope == "snapshot"
  and .refs[0].workspace_id == "ws-canvas"
  and .refs[0].snapshot_id == "snapcanvas"
  and .refs[0].capture_target == "main"
  and .refs[0].capture_mode == "som"
  and .refs[0].backend == "aos_canvas"
  and .refs[0].resolution_class == "reacquirable"
  and .refs[0].confidence == "high"
  and .refs[0].action_target == "canvas:canvas-fixture/brightness-slider"
  and .refs[0].copyable_action_target == "ref:snapcanvas:r2"
  and (.refs[0].supported_actions == ["set-value"])
  and .refs[0].identity_facts.state_id == "see_canvas_fixture"
  and .refs[0].identity_facts.source_ref == "brightness-slider"
  and .refs[0].identity_facts.canvas_id == "canvas-fixture"
  and .refs[0].identity_facts.target.target_id == "fixture.brightness"
  and .refs[0].identity_facts.reacquisition.strategy == "owner-structural-fingerprint"
  and .refs[0].current_address.action_target == "canvas:canvas-fixture/brightness-slider"
  and .refs[0].conformance.actionability == "reacquirable_saved_ref_mutation"
  and .refs[0].conformance.mutation == "supported_after_current_resolution"
  and .refs[0].conformance.validation == "current_canvas_target_resolution"
  and .refs[0].conformance.proof.status == "deterministic_contract_tests_passed"
  and (.refs[0].conformance.proof.approval_gates | length) == 0
  and .refs[0].conformance.no_foreground.claim == "not_applicable"
  and .refs[0].conformance.target_uncertainty.status == "requires_current_resolution"
  and (has("elements") | not)
  and (.refs[0] | has("short_action_target") | not)
' "$CANVAS_CURRENT_REFS" >/dev/null || fail "AOS canvas current refs readback drifted: $(cat "$CANVAS_CURRENT_REFS")"
assert_no_heavy_capture_payloads "$CANVAS_CURRENT_REFS" "canvas current refs readback"

cp "$CANVAS_REFS_PATH" "$CANVAS_REFS_PATH.coordinate-backup"
jq '(.refs[0]) |= (
    .resolution_class = "coordinate_fallback"
    | .action_target = "10,20"
    | .current_address.action_target = "10,20"
    | .supported_actions = ["click"]
    | .conformance.actionability = "diagnostic_fallback_refused"
    | .conformance.mutation = "refused"
    | .conformance.validation = "coordinate_fallback_refused_before_dispatch"
    | .conformance.proof.level = "known_limit_contract"
    | .conformance.proof.status = "known_limit_refusal_tested"
    | .conformance.target_uncertainty.status = "blocked_coordinate_fallback"
    | .conformance.target_uncertainty.reasons = ["coordinate fallback refs are diagnostic-only and refused before dispatch"]
    | .warnings = ((.warnings // []) + ["coordinate fallback is diagnostic-only"])
    | .known_limits = ((.known_limits // []) + ["coordinate-backed saved-ref mutation is refused in v0"])
  )' "$CANVAS_REFS_PATH.coordinate-backup" >"$CANVAS_REFS_PATH"
CANVAS_COORDINATE_FALLBACK_ERR="$TMP_DIR/do-canvas-coordinate-fallback.err"
if AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-ref.mjs click ref:snapcanvas:r1 --workspace ws-canvas --dry-run >"$TMP_DIR/do-canvas-coordinate-fallback.out" 2>"$CANVAS_COORDINATE_FALLBACK_ERR"; then
    mv "$CANVAS_REFS_PATH.coordinate-backup" "$CANVAS_REFS_PATH"
    fail "AOS canvas coordinate fallback diagnostic ref unexpectedly became actionable"
fi
mv "$CANVAS_REFS_PATH.coordinate-backup" "$CANVAS_REFS_PATH"
expect_error_code "REF_UNSUPPORTED" "$CANVAS_COORDINATE_FALLBACK_ERR"
jq -e '
  .status == "unsupported"
  and .ref.backend == "aos_canvas"
  and .ref.resolution_class == "coordinate_fallback"
  and .ref.current_address.action_target == "10,20"
  and .ref.conformance.actionability == "diagnostic_fallback_refused"
  and .ref.conformance.proof.status == "known_limit_refusal_tested"
  and .ref.conformance.target_uncertainty.status == "blocked_coordinate_fallback"
  and any(.ref.warnings[]; contains("diagnostic-only"))
  and .recommended_next_command == "aos see capture main --save --workspace ws-canvas --mode som"
' "$CANVAS_COORDINATE_FALLBACK_ERR" >/dev/null \
    || fail "AOS canvas coordinate fallback diagnostic ref did not refuse before dispatch: $(cat "$CANVAS_COORDINATE_FALLBACK_ERR")"

CANVAS_DRY="$TMP_DIR/do-canvas-dry-run.json"
AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-ref.mjs click ref:snapcanvas:r1 --workspace ws-canvas --dry-run >"$CANVAS_DRY"
jq -e '
  .status == "dry_run"
  and .ref.backend == "aos_canvas"
  and .ref.resolution_class == "reacquirable"
  and .ref.conformance.proof_level == "deterministic_contract_tests"
  and .resolved_action.resolution_status == "resolved"
  and (.resolved_action.command | index("canvas:canvas-fixture/save-button") != null)
  and (.resolved_action.command | index("--state-id") != null)
  and (.resolved_action.command | index("see_canvas_fixture") != null)
' "$CANVAS_DRY" >/dev/null || fail "AOS canvas ref dry-run drifted: $(cat "$CANVAS_DRY")"

CANVAS_DWELL_DRY="$TMP_DIR/do-canvas-click-dwell-dry-run.json"
AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-ref.mjs click ref:snapcanvas:r1 --workspace ws-canvas --dwell 25 --dry-run >"$CANVAS_DWELL_DRY"
jq -e '
  .status == "dry_run"
  and .ref.backend == "aos_canvas"
  and .resolved_action.resolution_status == "resolved"
  and (.resolved_action.command | index("--dwell") != null)
  and (.resolved_action.command | index("25") != null)
' "$CANVAS_DWELL_DRY" >/dev/null || fail "AOS canvas click ref dwell dry-run drifted: $(cat "$CANVAS_DWELL_DRY")"

CANVAS_ACTION="$TMP_DIR/do-canvas-action.json"
AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-ref.mjs click ref:snapcanvas:r1 --workspace ws-canvas >"$CANVAS_ACTION"
jq -e '
  .status == "success"
  and .schema_version == "aos.agent-workspace.v0"
  and .action == "click"
  and .ref.backend == "aos_canvas"
  and .current_validation == null
  and .resolved_action.resolution_status == "resolved"
  and .resolved_action.exit_code == 0
  and .underlying_exit_code == 0
  and .underlying_result.execution.backend == "canvas"
  and .underlying_result.execution.state_id == "see_canvas_fixture"
  and (.underlying_result.received | index("canvas:canvas-fixture/save-button") != null)
  and .post_action.verification == "fresh_capture_recommended"
  and .post_action.recommended_next_command == "aos see capture main --save --workspace ws-canvas --mode som"
  and .recommended_next_command == "aos see capture main --save --workspace ws-canvas --mode som"
' "$CANVAS_ACTION" >/dev/null || fail "AOS canvas ref action drifted: $(cat "$CANVAS_ACTION")"

CANVAS_SET_DRY="$TMP_DIR/do-canvas-set-value-dry-run.json"
AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-ref.mjs set-value ref:snapcanvas:r2 --workspace ws-canvas --value 42 --dry-run >"$CANVAS_SET_DRY"
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
AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-ref.mjs set-value ref:snapcanvas:r2 --workspace ws-canvas --value 43 >"$CANVAS_SET_ACTION"
jq -e '
  .status == "success"
  and .schema_version == "aos.agent-workspace.v0"
  and .action == "set-value"
  and .ref.backend == "aos_canvas"
  and .resolved_action.resolution_status == "resolved"
  and .underlying_result.execution.backend == "canvas"
  and .underlying_result.execution.state_id == "see_canvas_fixture"
  and .underlying_result.value == "43"
  and (.underlying_result.received | index("canvas:canvas-fixture/brightness-slider") != null)
  and .post_action.verification == "fresh_capture_recommended"
  and .post_action.recommended_next_command == "aos see capture main --save --workspace ws-canvas --mode som"
  and .recommended_next_command == "aos see capture main --save --workspace ws-canvas --mode som"
' "$CANVAS_SET_ACTION" >/dev/null || fail "AOS canvas set-value ref action drifted: $(cat "$CANVAS_SET_ACTION")"

CANVAS_SET_POSITIONAL="$TMP_DIR/do-canvas-set-value-positional.json"
AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-ref.mjs set-value ref:snapcanvas:r2 44 --workspace ws-canvas >"$CANVAS_SET_POSITIONAL"
jq -e '
  .status == "success"
  and .schema_version == "aos.agent-workspace.v0"
  and .underlying_result.value == "44"
  and (.underlying_result.received | index("44") != null)
  and .post_action.verification == "fresh_capture_recommended"
  and .post_action.recommended_next_command == "aos see capture main --save --workspace ws-canvas --mode som"
  and .recommended_next_command == "aos see capture main --save --workspace ws-canvas --mode som"
' "$CANVAS_SET_POSITIONAL" >/dev/null || fail "AOS canvas positional set-value ref action drifted: $(cat "$CANVAS_SET_POSITIONAL")"

CANVAS_DIRECT_SET="$TMP_DIR/do-canvas-direct-set-value.json"
AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-native.mjs set-value canvas:canvas-fixture/brightness-slider --value 45 --dry-run >"$CANVAS_DIRECT_SET"
jq -e '
  .status == "dry_run_passthrough"
  and (.received | index("__do") != null)
  and (.received | index("set-value") != null)
  and (.received | index("canvas:canvas-fixture/brightness-slider") != null)
' "$CANVAS_DIRECT_SET" >/dev/null || fail "direct canvas set-value wrapper validation drifted: $(cat "$CANVAS_DIRECT_SET")"

CANVAS_DIRECT_SET_POSITIONAL="$TMP_DIR/do-canvas-direct-set-value-positional.json"
AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-native.mjs set-value canvas:canvas-fixture/brightness-slider 46 --dry-run >"$CANVAS_DIRECT_SET_POSITIONAL"
jq -e '
  .status == "dry_run_passthrough"
  and (.received | index("__do") != null)
  and (.received | index("set-value") != null)
  and (.received | index("canvas:canvas-fixture/brightness-slider") != null)
  and (.received | index("--value") != null)
  and (.received | index("46") != null)
' "$CANVAS_DIRECT_SET_POSITIONAL" >/dev/null || fail "direct canvas positional set-value wrapper normalization drifted: $(cat "$CANVAS_DIRECT_SET_POSITIONAL")"

CANVAS_DIRECT_SET_BOTH_VALUE_SOURCES_ERR="$TMP_DIR/do-canvas-direct-set-value-both-sources.err"
if AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-native.mjs set-value canvas:canvas-fixture/brightness-slider 46 --value 47 >"$TMP_DIR/do-canvas-direct-set-value-both-sources.out" 2>"$CANVAS_DIRECT_SET_BOTH_VALUE_SOURCES_ERR"; then
    fail "direct canvas set-value with both value sources unexpectedly succeeded"
fi
expect_error_code "INVALID_ARG" "$CANVAS_DIRECT_SET_BOTH_VALUE_SOURCES_ERR"
jq -e '.error | contains("exactly one value source")' "$CANVAS_DIRECT_SET_BOTH_VALUE_SOURCES_ERR" >/dev/null \
    || fail "direct canvas set-value both-source error did not explain one-source rule: $(cat "$CANVAS_DIRECT_SET_BOTH_VALUE_SOURCES_ERR")"

CANVAS_DIRECT_SET_BOTH_TARGET_SOURCES_ERR="$TMP_DIR/do-canvas-direct-set-value-both-target-sources.err"
if AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-native.mjs set-value canvas:canvas-fixture/brightness-slider --pid 4242 --role AXTextField --value 47 >"$TMP_DIR/do-canvas-direct-set-value-both-target-sources.out" 2>"$CANVAS_DIRECT_SET_BOTH_TARGET_SOURCES_ERR"; then
    fail "direct canvas set-value with both target sources unexpectedly succeeded"
fi
expect_error_code "INVALID_ARG" "$CANVAS_DIRECT_SET_BOTH_TARGET_SOURCES_ERR"
jq -e '.error | contains("exactly one target source")' "$CANVAS_DIRECT_SET_BOTH_TARGET_SOURCES_ERR" >/dev/null \
    || fail "direct canvas set-value both-target error did not explain one-target rule: $(cat "$CANVAS_DIRECT_SET_BOTH_TARGET_SOURCES_ERR")"

CANVAS_FOCUS_ERR="$TMP_DIR/do-canvas-focus.err"
if AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-ref.mjs focus ref:snapcanvas:r1 --workspace ws-canvas >"$TMP_DIR/do-canvas-focus.out" 2>"$CANVAS_FOCUS_ERR"; then
    fail "unsupported AOS canvas focus ref unexpectedly succeeded"
fi
expect_error_code "ACTION_INCOMPATIBLE" "$CANVAS_FOCUS_ERR"
jq -e '.status == "action_incompatible" and .ref.backend == "aos_canvas" and .safe_next_action == "aos see capture main --save --workspace ws-canvas --mode som"' "$CANVAS_FOCUS_ERR" >/dev/null \
    || fail "AOS canvas focus ref did not fail closed through action matrix: $(cat "$CANVAS_FOCUS_ERR")"

CANVAS_PRESS_ERR="$TMP_DIR/do-canvas-press.err"
if AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-ref.mjs press ref:snapcanvas:r1 --workspace ws-canvas >"$TMP_DIR/do-canvas-press.out" 2>"$CANVAS_PRESS_ERR"; then
    fail "unsupported AOS canvas press ref unexpectedly succeeded"
fi
expect_error_code "ACTION_INCOMPATIBLE" "$CANVAS_PRESS_ERR"
jq -e '.status == "action_incompatible" and .ref.backend == "aos_canvas"' "$CANVAS_PRESS_ERR" >/dev/null \
    || fail "AOS canvas press ref did not fail closed through action matrix: $(cat "$CANVAS_PRESS_ERR")"

CANVAS_SET_MISSING_VALUE_ERR="$TMP_DIR/do-canvas-set-value-missing.err"
if AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-ref.mjs set-value ref:snapcanvas:r2 --workspace ws-canvas --dry-run >"$TMP_DIR/do-canvas-set-value-missing.out" 2>"$CANVAS_SET_MISSING_VALUE_ERR"; then
    fail "set-value saved ref without value unexpectedly succeeded"
fi
expect_error_code "MISSING_ARG" "$CANVAS_SET_MISSING_VALUE_ERR"

CANVAS_SET_BOTH_VALUE_SOURCES_ERR="$TMP_DIR/do-canvas-set-value-both-sources.err"
if AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-ref.mjs set-value ref:snapcanvas:r2 46 --workspace ws-canvas --value 47 >"$TMP_DIR/do-canvas-set-value-both-sources.out" 2>"$CANVAS_SET_BOTH_VALUE_SOURCES_ERR"; then
    fail "set-value saved ref with both value sources unexpectedly succeeded"
fi
expect_error_code "INVALID_ARG" "$CANVAS_SET_BOTH_VALUE_SOURCES_ERR"
jq -e '.error | contains("exactly one value source")' "$CANVAS_SET_BOTH_VALUE_SOURCES_ERR" >/dev/null \
    || fail "set-value both-source error did not explain one-source rule: $(cat "$CANVAS_SET_BOTH_VALUE_SOURCES_ERR")"

CANVAS_SET_EXTRA_POSITIONAL_ERR="$TMP_DIR/do-canvas-set-value-extra-positional.err"
if AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-ref.mjs set-value ref:snapcanvas:r2 46 47 --workspace ws-canvas >"$TMP_DIR/do-canvas-set-value-extra-positional.out" 2>"$CANVAS_SET_EXTRA_POSITIONAL_ERR"; then
    fail "set-value saved ref with extra positional value unexpectedly succeeded"
fi
expect_error_code "UNKNOWN_ARG" "$CANVAS_SET_EXTRA_POSITIONAL_ERR"

CANVAS_INCOMPATIBLE_ERR="$TMP_DIR/do-canvas-incompatible.err"
if AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-ref.mjs type ref:snapcanvas:r1 --workspace ws-canvas >"$TMP_DIR/do-canvas-incompatible.out" 2>"$CANVAS_INCOMPATIBLE_ERR"; then
    fail "incompatible AOS canvas ref action unexpectedly succeeded"
fi
expect_error_code "ACTION_INCOMPATIBLE" "$CANVAS_INCOMPATIBLE_ERR"
jq -e '
  .status == "action_incompatible"
  and (.supported_actions | index("click") != null)
  and .recommended_next_command == "aos see capture main --save --workspace ws-canvas --mode som"
' "$CANVAS_INCOMPATIBLE_ERR" >/dev/null || fail "incompatible AOS canvas type ref action lacked safe next command: $(cat "$CANVAS_INCOMPATIBLE_ERR")"

CANVAS_KEY_INCOMPATIBLE_ERR="$TMP_DIR/do-canvas-key-incompatible.err"
if AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-do-ref.mjs key ref:snapcanvas:r1 --workspace ws-canvas >"$TMP_DIR/do-canvas-key-incompatible.out" 2>"$CANVAS_KEY_INCOMPATIBLE_ERR"; then
    fail "incompatible AOS canvas key ref action unexpectedly succeeded"
fi
expect_error_code "ACTION_INCOMPATIBLE" "$CANVAS_KEY_INCOMPATIBLE_ERR"
jq -e '
  .status == "action_incompatible"
  and (.supported_actions | index("click") != null)
  and .recommended_next_command == "aos see capture main --save --workspace ws-canvas --mode som"
' "$CANVAS_KEY_INCOMPATIBLE_ERR" >/dev/null || fail "incompatible AOS canvas key ref action lacked safe next command: $(cat "$CANVAS_KEY_INCOMPATIBLE_ERR")"

CANVAS_QUERY="$TMP_DIR/capture-canvas-query.json"
AOS_PATH="$FAKE_CANVAS_AOS" node scripts/aos-see-native.mjs capture main --save --mode som --workspace ws-canvas-query --name snapcanvasq --query Brightness >"$CANVAS_QUERY"
jq -e '
  .status == "success"
  and (.refs | length) == 1
  and .refs[0].ref == "r2"
  and (.refs[0].supported_actions == ["set-value"])
  and (.recommended_next_commands[] == "aos do set-value ref:snapcanvasq:r2 --workspace ws-canvas-query --value 42 --dry-run")
' "$CANVAS_QUERY" >/dev/null || fail "set-value-only compact recommendation drifted: $(cat "$CANVAS_QUERY")"

FAKE_MIXED_SUPPORT_AOS="$TMP_DIR/fake-mixed-support-aos"
write_fake_mixed_support_aos "$FAKE_MIXED_SUPPORT_AOS"
MIXED="$TMP_DIR/capture-mixed-support.json"
AOS_PATH="$FAKE_MIXED_SUPPORT_AOS" node scripts/aos-see-native.mjs capture main --save --mode som --workspace ws-mixed --name snapmixed >"$MIXED"
jq -e '
  .status == "success"
  and .refs[0].ref == "r1"
  and (.refs[0].supported_actions | length) == 0
  and .refs[1].ref == "r2"
  and (.refs[1].supported_actions == ["click"])
  and (.recommended_next_commands[] == "aos do click ref:snapmixed:r2 --workspace ws-mixed --dry-run")
  and all(.recommended_next_commands[]; contains("ref:snapmixed:r1") | not)
' "$MIXED" >/dev/null || fail "unsupported-first compact recommendation drifted: $(cat "$MIXED")"

echo "PASS canvas refs"
