#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tests/lib/agent-workspace-fixtures.sh"
agent_workspace_test_setup

CAP1="$TMP_DIR/capture-snap1.json"
./aos see capture browser:todo --save --mode ax --workspace ws-browser --name snap1 --query "Click me" >"$CAP1"
REF="$(jq -r '.refs[0].ref' "$CAP1")"
[[ "$REF" == "r2" ]] || fail "expected query to resolve r2, got $REF"
jq -e '.query == "Click me"' "$CAP1" >/dev/null || fail "saved capture did not preserve spaced query: $(cat "$CAP1")"
WORKSPACE_PATH="$(jq -r '.paths.workspace' "$CAP1")"
REFS_PATH="$(jq -r '.paths.refs' "$CAP1")"

REFS="$TMP_DIR/refs-snap1.json"
./aos see refs --workspace ws-browser --snapshot snap1 --query "Click me" --json >"$REFS"
jq -e '
  .status == "success"
  and .workspace_id == "ws-browser"
  and .snapshot_id == "snap1"
  and (.refs | length) == 1
  and .refs[0].copyable_action_target == "ref:snap1:r2"
  and .refs[0].capture_target == "browser:todo"
  and .refs[0].capture_mode == "ax"
  and .refs[0].identity_facts.page_url == "https://fixture.local/todo"
  and (.refs[0].hint_facts.role | length > 0)
  and .refs[0].current_address.action_target == "browser:todo/e2"
  and .refs[0].conformance.actionability == "validated_saved_ref_mutation"
  and .refs[0].conformance.validation == "browser_page_frame_navigation_and_element_revalidation"
  and .refs[0].conformance.proof.level == "deterministic_contract_tests"
  and .refs[0].conformance.proof.status == "deterministic_contract_tests_passed"
  and (.refs[0].conformance.proof.evidence | index("tests/agent-workspace-browser-refs.sh") != null)
  and (.refs[0].conformance.proof.evidence | index("tests/agent-workspace-saved-ref.sh") != null)
  and (.refs[0].conformance.proof.approval_gates | length) == 0
  and .refs[0].conformance.no_foreground.claim == "not_applicable"
  and .refs[0].conformance.target_uncertainty.status == "requires_current_validation"
  and any(.refs[0].conformance.target_uncertainty.reasons[]; contains("page/frame/navigation"))
' "$REFS" >/dev/null || fail "refs readback shape drifted: $(cat "$REFS")"
assert_no_heavy_capture_payloads "$REFS" "browser snapshot refs readback"

CURRENT_REFS="$TMP_DIR/refs-current.json"
./aos see refs --workspace ws-browser --query "Click me" --json >"$CURRENT_REFS"
jq -e '
  .status == "success"
  and .schema_version == "aos.agent-workspace.v0"
  and .workspace_id == "ws-browser"
  and .snapshot_id == "snap1"
  and .query == "Click me"
  and (.refs | length) == 1
  and .refs[0].ref == "r2"
  and .refs[0].ref_scope == "snapshot"
  and .refs[0].workspace_id == "ws-browser"
  and .refs[0].snapshot_id == "snap1"
  and .refs[0].copyable_action_target == "ref:snap1:r2"
  and .refs[0].capture_target == "browser:todo"
  and .refs[0].capture_mode == "ax"
  and .refs[0].current_address.action_target == "browser:todo/e2"
  and .refs[0].conformance.proof.status == "deterministic_contract_tests_passed"
  and .refs[0].conformance.target_uncertainty.status == "requires_current_validation"
  and (has("elements") | not)
  and (has("semantic_targets") | not)
  and (has("base64") | not)
  and (.refs[0] | has("short_action_target") | not)
  and (.refs[0] | has("elements") | not)
  and (.refs[0] | has("semantic_targets") | not)
  and (.refs[0] | has("base64") | not)
' "$CURRENT_REFS" >/dev/null || fail "current refs readback shape drifted: $(cat "$CURRENT_REFS")"
assert_no_heavy_capture_payloads "$CURRENT_REFS" "browser current refs readback"

DRY="$TMP_DIR/do-ref-dry-run.json"
./aos do click "ref:snap1:$REF" --workspace ws-browser --dry-run >"$DRY"
jq -e '
  .status == "dry_run"
  and .schema_version == "aos.agent-workspace.v0"
  and .action == "click"
  and .workspace_id == "ws-browser"
  and .snapshot_id == "snap1"
  and .ref.ref == "r2"
  and .ref.conformance.mutation == "supported_after_validation"
  and .resolved_action.resolution_status == "reacquired"
  and .current_validation.status == "reacquired"
  and .current_validation.current_target.ref == "e2"
  and .current_validation.current_identity.page_url == "https://fixture.local/todo"
  and (.resolved_action.command | index("browser:todo/e2") != null)
  and .recommended_next_command == null
' "$DRY" >/dev/null || fail "browser ref dry-run reacquired shape drifted: $(cat "$DRY")"

BARE_DRY="$TMP_DIR/do-ref-bare-dry-run.json"
./aos do click "ref:$REF" --workspace ws-browser --dry-run >"$BARE_DRY"
jq -e '
  .status == "dry_run"
  and .snapshot_id == "snap1"
  and .ref.ref == "r2"
  and .resolved_action.resolution_status == "reacquired"
  and .current_validation.status == "reacquired"
' "$BARE_DRY" >/dev/null || fail "bare browser ref dry-run shape drifted before ambiguity: $(cat "$BARE_DRY")"

REAL_ACTION="$TMP_DIR/do-ref-real.json"
./aos do click "ref:snap1:$REF" --workspace ws-browser >"$REAL_ACTION"
jq -e '
  .status == "success"
  and .schema_version == "aos.agent-workspace.v0"
  and .action == "click"
  and .ref.backend == "browser"
  and .current_validation.status == "reacquired"
  and .current_validation.current_target.ref == "e2"
  and .resolved_action.resolution_status == "reacquired"
  and .resolved_action.exit_code == 0
  and .underlying_exit_code == 0
  and .underlying_result.execution.backend == "playwright"
  and .underlying_result.execution.strategy == "playwright_click"
  and (.underlying_result.result.stdout | contains("fake click invoked: -s=todo click e2"))
  and .post_action.verification == "fresh_capture_recommended"
  and .post_action.recommended_next_command == "aos see capture browser:todo --save --workspace ws-browser --mode ax --query \u0027Click me\u0027"
  and .recommended_next_command == "aos see capture browser:todo --save --workspace ws-browser --mode ax --query \u0027Click me\u0027"
' "$REAL_ACTION" >/dev/null || fail "browser saved-ref click did not dispatch after validation: $(cat "$REAL_ACTION")"

cp "$REFS_PATH" "$REFS_PATH.coordinate-backup"
jq '(.refs[] | select(.ref == "r2")) |= (
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
  )' "$REFS_PATH.coordinate-backup" >"$REFS_PATH"
BROWSER_COORDINATE_FALLBACK_ERR="$TMP_DIR/do-browser-coordinate-fallback.err"
if ./aos do click "ref:snap1:$REF" --workspace ws-browser --dry-run >"$TMP_DIR/do-browser-coordinate-fallback.out" 2>"$BROWSER_COORDINATE_FALLBACK_ERR"; then
    mv "$REFS_PATH.coordinate-backup" "$REFS_PATH"
    fail "browser coordinate fallback diagnostic ref unexpectedly became actionable"
fi
mv "$REFS_PATH.coordinate-backup" "$REFS_PATH"
expect_error_code "REF_UNSUPPORTED" "$BROWSER_COORDINATE_FALLBACK_ERR"
jq -e '
  .status == "unsupported"
  and .ref.backend == "browser"
  and .ref.resolution_class == "coordinate_fallback"
  and .ref.current_address.action_target == "10,20"
  and .ref.conformance.actionability == "diagnostic_fallback_refused"
  and .ref.conformance.proof.status == "known_limit_refusal_tested"
  and .ref.conformance.target_uncertainty.status == "blocked_coordinate_fallback"
  and any(.ref.warnings[]; contains("diagnostic-only"))
  and .recommended_next_command == "aos see capture browser:todo --save --workspace ws-browser --mode ax --query \u0027Click me\u0027"
' "$BROWSER_COORDINATE_FALLBACK_ERR" >/dev/null \
    || fail "browser coordinate fallback diagnostic ref did not refuse before dispatch: $(cat "$BROWSER_COORDINATE_FALLBACK_ERR")"

CLICK_EXTRA_ERR="$TMP_DIR/do-ref-click-extra.err"
if ./aos do click "ref:snap1:$REF" extra --workspace ws-browser --dry-run >"$TMP_DIR/do-ref-click-extra.out" 2>"$CLICK_EXTRA_ERR"; then
    fail "browser saved-ref click with extra positional unexpectedly succeeded"
fi
expect_error_code "UNKNOWN_ARG" "$CLICK_EXTRA_ERR"

CLICK_DWELL_ERR="$TMP_DIR/do-ref-click-dwell.err"
if ./aos do click "ref:snap1:$REF" --dwell 25 --workspace ws-browser --dry-run >"$TMP_DIR/do-ref-click-dwell.out" 2>"$CLICK_DWELL_ERR"; then
    fail "browser saved-ref click with unsupported dwell flag unexpectedly succeeded"
fi
expect_error_code "UNKNOWN_FLAG" "$CLICK_DWELL_ERR"

HOVER_DRY="$TMP_DIR/do-ref-hover-dry.json"
./aos do hover "ref:snap1:$REF" --workspace ws-browser --dry-run >"$HOVER_DRY"
jq -e '
  .status == "dry_run"
  and .action == "hover"
  and .resolved_action.resolution_status == "reacquired"
  and .current_validation.current_target.ref == "e2"
  and (.resolved_action.command | index("browser:todo/e2") != null)
' "$HOVER_DRY" >/dev/null || fail "browser hover saved-ref dry-run drifted: $(cat "$HOVER_DRY")"

HOVER_REAL="$TMP_DIR/do-ref-hover-real.json"
./aos do hover "ref:snap1:$REF" --workspace ws-browser >"$HOVER_REAL"
jq -e '
  .status == "success"
  and .action == "hover"
  and .current_validation.status == "reacquired"
  and .underlying_result.execution.strategy == "playwright_hover"
  and (.underlying_result.result.stdout | contains("fake hover invoked: -s=todo hover e2"))
  and .post_action.verification == "fresh_capture_recommended"
  and .post_action.recommended_next_command == "aos see capture browser:todo --save --workspace ws-browser --mode ax --query \u0027Click me\u0027"
  and .recommended_next_command == "aos see capture browser:todo --save --workspace ws-browser --mode ax --query \u0027Click me\u0027"
' "$HOVER_REAL" >/dev/null \
    || fail "browser saved-ref hover did not dispatch after validation: $(cat "$HOVER_REAL")"

HOVER_EXTRA_ERR="$TMP_DIR/do-ref-hover-extra.err"
if ./aos do hover "ref:snap1:$REF" extra --workspace ws-browser --dry-run >"$TMP_DIR/do-ref-hover-extra.out" 2>"$HOVER_EXTRA_ERR"; then
    fail "browser saved-ref hover with extra positional unexpectedly succeeded"
fi
expect_error_code "UNKNOWN_ARG" "$HOVER_EXTRA_ERR"

HOVER_UNKNOWN_FLAG_ERR="$TMP_DIR/do-ref-hover-unknown-flag.err"
if ./aos do hover "ref:snap1:$REF" --bogus --workspace ws-browser --dry-run >"$TMP_DIR/do-ref-hover-unknown-flag.out" 2>"$HOVER_UNKNOWN_FLAG_ERR"; then
    fail "browser saved-ref hover with unknown flag unexpectedly succeeded"
fi
expect_error_code "UNKNOWN_FLAG" "$HOVER_UNKNOWN_FLAG_ERR"

SCROLL_DRY="$TMP_DIR/do-ref-scroll-dry.json"
./aos do scroll "ref:snap1:$REF" 0,-200 --workspace ws-browser --dry-run >"$SCROLL_DRY"
jq -e '
  .status == "dry_run"
  and .action == "scroll"
  and .resolved_action.resolution_status == "reacquired"
  and .current_validation.current_target.ref == "e2"
  and (.resolved_action.command | index("browser:todo/e2") != null)
  and (.resolved_action.command | index("0,-200") != null)
' "$SCROLL_DRY" >/dev/null || fail "browser scroll saved-ref dry-run drifted: $(cat "$SCROLL_DRY")"

SCROLL_REAL="$TMP_DIR/do-ref-scroll-real.json"
./aos do scroll "ref:snap1:$REF" 0,-200 --workspace ws-browser >"$SCROLL_REAL"
jq -e '
  .status == "success"
  and .action == "scroll"
  and .current_validation.status == "reacquired"
  and .underlying_result.execution.strategy == "playwright_mousewheel"
  and (.underlying_result.result.stdout | contains("fake mousewheel invoked: -s=todo mousewheel e2 0 -200"))
  and .post_action.verification == "fresh_capture_recommended"
  and .post_action.recommended_next_command == "aos see capture browser:todo --save --workspace ws-browser --mode ax --query \u0027Click me\u0027"
  and .recommended_next_command == "aos see capture browser:todo --save --workspace ws-browser --mode ax --query \u0027Click me\u0027"
' "$SCROLL_REAL" >/dev/null \
    || fail "browser saved-ref scroll did not dispatch after validation: $(cat "$SCROLL_REAL")"

DRAG_DRY="$TMP_DIR/do-ref-drag-dry.json"
./aos do drag "ref:snap1:$REF" ref:snap1:r3 --workspace ws-browser --dry-run >"$DRAG_DRY"
jq -e '
  .status == "dry_run"
  and .action == "drag"
  and .resolved_action.resolution_status == "reacquired"
  and .current_validation.current_target.ref == "e2"
  and .secondary_ref.ref == "r3"
  and .secondary_current_validation.current_target.ref == "e3"
  and (.resolved_action.command | index("browser:todo/e2") != null)
  and (.resolved_action.command | index("browser:todo/e3") != null)
' "$DRAG_DRY" >/dev/null || fail "browser drag saved-ref dry-run drifted: $(cat "$DRAG_DRY")"

DRAG_REAL="$TMP_DIR/do-ref-drag-real.json"
./aos do drag "ref:snap1:$REF" ref:snap1:r3 --workspace ws-browser >"$DRAG_REAL"
jq -e '
  .status == "success"
  and .action == "drag"
  and .current_validation.status == "reacquired"
  and .secondary_current_validation.status == "reacquired"
  and .secondary_ref.ref == "r3"
  and .underlying_result.execution.strategy == "playwright_drag"
  and (.underlying_result.result.stdout | contains("fake drag invoked: -s=todo drag e2 e3"))
  and .post_action.verification == "fresh_capture_recommended"
  and .post_action.recommended_next_command == "aos see capture browser:todo --save --workspace ws-browser --mode ax --query \u0027Click me\u0027"
  and .recommended_next_command == "aos see capture browser:todo --save --workspace ws-browser --mode ax --query \u0027Click me\u0027"
' "$DRAG_REAL" >/dev/null \
    || fail "browser saved-ref drag did not dispatch after validation: $(cat "$DRAG_REAL")"

cp "$REFS_PATH" "$REFS_PATH.revalidation-backup"
jq '(.refs[] | select(.ref == "r2") | .identity_facts.page_url) = null' "$REFS_PATH.revalidation-backup" >"$REFS_PATH"
REVALIDATION_ERR="$TMP_DIR/do-ref-revalidation-required.err"
if ./aos do click "ref:snap1:$REF" --workspace ws-browser >"$TMP_DIR/do-ref-revalidation-required.out" 2>"$REVALIDATION_ERR"; then
    mv "$REFS_PATH.revalidation-backup" "$REFS_PATH"
    fail "browser saved-ref with missing identity unexpectedly dispatched"
fi
mv "$REFS_PATH.revalidation-backup" "$REFS_PATH"
expect_error_code "REF_REVALIDATION_REQUIRED" "$REVALIDATION_ERR"
jq -e '.status == "validation_required" and .reason == "missing_saved_page_url" and .recommended_next_command == "aos see capture browser:todo --save --workspace ws-browser --mode ax --query \u0027Click me\u0027"' "$REVALIDATION_ERR" >/dev/null \
    || fail "browser revalidation-required recommendation drifted: $(cat "$REVALIDATION_ERR")"

cp "$REFS_PATH" "$REFS_PATH.drag-backup"
jq '(.refs[] | select(.ref == "r3") | .action_target) = "browser:other/e3"
  | (.refs[] | select(.ref == "r3") | .identity_facts.session) = "other"' "$REFS_PATH.drag-backup" >"$REFS_PATH"
DRAG_CROSS_SESSION_ERR="$TMP_DIR/do-ref-drag-cross-session.err"
if ./aos do drag "ref:snap1:$REF" ref:snap1:r3 --workspace ws-browser --dry-run >"$TMP_DIR/do-ref-drag-cross-session.out" 2>"$DRAG_CROSS_SESSION_ERR"; then
    mv "$REFS_PATH.drag-backup" "$REFS_PATH"
    fail "browser saved-ref cross-session drag unexpectedly succeeded"
fi
mv "$REFS_PATH.drag-backup" "$REFS_PATH"
expect_error_code "ACTION_INCOMPATIBLE" "$DRAG_CROSS_SESSION_ERR"
jq -e '.status == "action_incompatible" and .reason == "session_mismatch"' "$DRAG_CROSS_SESSION_ERR" >/dev/null \
    || fail "cross-session drag did not fail closed: $(cat "$DRAG_CROSS_SESSION_ERR")"

DRAG_MISSING_ERR="$TMP_DIR/do-ref-drag-missing.err"
if ./aos do drag "ref:snap1:$REF" --workspace ws-browser --dry-run >"$TMP_DIR/do-ref-drag-missing.out" 2>"$DRAG_MISSING_ERR"; then
    fail "browser saved-ref drag without destination unexpectedly succeeded"
fi
expect_error_code "MISSING_ARG" "$DRAG_MISSING_ERR"

DRAG_INVALID_ERR="$TMP_DIR/do-ref-drag-invalid.err"
if ./aos do drag "ref:snap1:$REF" browser:todo/e3 --workspace ws-browser --dry-run >"$TMP_DIR/do-ref-drag-invalid.out" 2>"$DRAG_INVALID_ERR"; then
    fail "browser saved-ref drag with non-ref destination unexpectedly succeeded"
fi
expect_error_code "INVALID_REF_TARGET" "$DRAG_INVALID_ERR"

DRAG_EXTRA_ERR="$TMP_DIR/do-ref-drag-extra.err"
if ./aos do drag "ref:snap1:$REF" ref:snap1:r3 ref:snap1:r4 --workspace ws-browser --dry-run >"$TMP_DIR/do-ref-drag-extra.out" 2>"$DRAG_EXTRA_ERR"; then
    fail "browser saved-ref drag with extra destination unexpectedly succeeded"
fi
expect_error_code "UNKNOWN_ARG" "$DRAG_EXTRA_ERR"

SCROLL_MISSING_ERR="$TMP_DIR/do-ref-scroll-missing.err"
if ./aos do scroll "ref:snap1:$REF" --workspace ws-browser --dry-run >"$TMP_DIR/do-ref-scroll-missing.out" 2>"$SCROLL_MISSING_ERR"; then
    fail "browser saved-ref scroll without delta unexpectedly succeeded"
fi
expect_error_code "MISSING_ARG" "$SCROLL_MISSING_ERR"

SCROLL_INVALID_ERR="$TMP_DIR/do-ref-scroll-invalid.err"
if ./aos do scroll "ref:snap1:$REF" nope --workspace ws-browser --dry-run >"$TMP_DIR/do-ref-scroll-invalid.out" 2>"$SCROLL_INVALID_ERR"; then
    fail "browser saved-ref scroll with invalid delta unexpectedly succeeded"
fi
expect_error_code "INVALID_ARG" "$SCROLL_INVALID_ERR"

SCROLL_EXTRA_ERR="$TMP_DIR/do-ref-scroll-extra.err"
if ./aos do scroll "ref:snap1:$REF" 0,-200 0,-300 --workspace ws-browser --dry-run >"$TMP_DIR/do-ref-scroll-extra.out" 2>"$SCROLL_EXTRA_ERR"; then
    fail "browser saved-ref scroll with extra delta unexpectedly succeeded"
fi
expect_error_code "UNKNOWN_ARG" "$SCROLL_EXTRA_ERR"

CAP2="$TMP_DIR/capture-snap2.json"
./aos see capture browser:todo --save --mode ax --workspace ws-browser --name snap2 >"$CAP2"
jq -e '.status == "success" and .snapshot_id == "snap2" and .capture_mode == "ax"' "$CAP2" >/dev/null \
    || fail "second browser capture failed: $(cat "$CAP2")"
jq -e '([.snapshots[].snapshot_id] | index("snap1") != null and index("snap2") != null)' "$WORKSPACE_PATH/index.json" >/dev/null \
    || fail "sequential browser saves did not preserve both committed snapshot index entries: $(cat "$WORKSPACE_PATH/index.json")"

DRAG_CROSS_SNAPSHOT_ERR="$TMP_DIR/do-ref-drag-cross-snapshot.err"
if ./aos do drag "ref:snap1:$REF" ref:snap2:r3 --workspace ws-browser --dry-run >"$TMP_DIR/do-ref-drag-cross-snapshot.out" 2>"$DRAG_CROSS_SNAPSHOT_ERR"; then
    fail "browser saved-ref cross-snapshot drag unexpectedly succeeded"
fi
expect_error_code "ACTION_INCOMPATIBLE" "$DRAG_CROSS_SNAPSHOT_ERR"
jq -e '.status == "action_incompatible" and .reason == "snapshot_mismatch"' "$DRAG_CROSS_SNAPSHOT_ERR" >/dev/null \
    || fail "cross-snapshot drag did not fail closed: $(cat "$DRAG_CROSS_SNAPSHOT_ERR")"

AMBIG_ERR="$TMP_DIR/do-ref-ambiguous.err"
if ./aos do click "ref:$REF" --workspace ws-browser --dry-run >"$TMP_DIR/do-ref-ambiguous.out" 2>"$AMBIG_ERR"; then
    fail "bare ref unexpectedly resolved across multiple snapshots"
fi
expect_error_code "REF_AMBIGUOUS" "$AMBIG_ERR"
jq -e '
  .status == "ambiguous"
  and .ref == "r2"
  and .workspace_id == "ws-browser"
  and (.candidates | length) >= 2
  and all(.candidates[]; .snapshot_id != null and .ref == "r2")
  and (.safe_next_action | contains("ref:<snapshot-id>:r2"))
  and (.recommended_next_commands | length) >= 2
  and all(.recommended_next_commands[]; contains("aos see refs --workspace ws-browser --snapshot"))
  and .requires_user_approval == false
' "$AMBIG_ERR" >/dev/null \
    || fail "bare-ref ambiguity payload drifted: $(cat "$AMBIG_ERR")"

MISSING_REF_ERR="$TMP_DIR/do-ref-missing.err"
if ./aos do click ref:snap1:r999 --workspace ws-browser --dry-run >"$TMP_DIR/do-ref-missing.out" 2>"$MISSING_REF_ERR"; then
    fail "missing saved ref unexpectedly resolved"
fi
expect_error_code "REF_NOT_FOUND" "$MISSING_REF_ERR"
jq -e '
  .status == "not_found"
  and .ref == "r999"
  and .workspace_id == "ws-browser"
  and .snapshot_id == "snap1"
  and .safe_next_action == "aos see refs --workspace ws-browser --snapshot snap1 --json"
  and .recommended_next_command == "aos see refs --workspace ws-browser --snapshot snap1 --json"
  and .requires_user_approval == false
' "$MISSING_REF_ERR" >/dev/null \
    || fail "missing-ref payload drifted: $(cat "$MISSING_REF_ERR")"

cp "$REFS_PATH" "$REFS_PATH.low-confidence-backup"
jq '(.refs[] | select(.ref == "r2") | .confidence) = "low"' "$REFS_PATH.low-confidence-backup" >"$REFS_PATH"
LOW_CONFIDENCE_ERR="$TMP_DIR/do-ref-low-confidence.err"
if ./aos do click "ref:snap1:$REF" --workspace ws-browser --dry-run >"$TMP_DIR/do-ref-low-confidence.out" 2>"$LOW_CONFIDENCE_ERR"; then
    mv "$REFS_PATH.low-confidence-backup" "$REFS_PATH"
    fail "low-confidence browser saved ref unexpectedly became actionable"
fi
mv "$REFS_PATH.low-confidence-backup" "$REFS_PATH"
expect_error_code "REF_UNSUPPORTED" "$LOW_CONFIDENCE_ERR"
jq -e '
  .status == "unsupported"
  and .reason == "low_confidence_target"
  and .ref.ref == "r2"
  and .ref.confidence == "low"
  and .recommended_next_command == "aos see capture browser:todo --save --workspace ws-browser --mode ax --query \u0027Click me\u0027"
' "$LOW_CONFIDENCE_ERR" >/dev/null || fail "low-confidence browser ref did not fail closed: $(cat "$LOW_CONFIDENCE_ERR")"

TYPE_UNSUPPORTED_ERR="$TMP_DIR/do-ref-type-unsupported.err"
if ./aos do type "ref:snap1:$REF" --workspace ws-browser --dry-run >"$TMP_DIR/do-ref-type-unsupported.out" 2>"$TYPE_UNSUPPORTED_ERR"; then
    fail "unsupported browser saved-ref type unexpectedly succeeded"
fi
expect_error_code "ACTION_INCOMPATIBLE" "$TYPE_UNSUPPORTED_ERR"
jq -e '
  .status == "action_incompatible"
  and .ref.ref == "r2"
  and (.supported_actions | index("click") != null)
  and (.supported_actions | index("type") | not)
  and .recommended_next_command == "aos see capture browser:todo --save --workspace ws-browser --mode ax --query \u0027Click me\u0027"
' "$TYPE_UNSUPPORTED_ERR" >/dev/null || fail "unsupported browser saved-ref type lacked safe next command: $(cat "$TYPE_UNSUPPORTED_ERR")"

KEY_UNSUPPORTED_ERR="$TMP_DIR/do-ref-key-unsupported.err"
if ./aos do key "ref:snap1:$REF" --workspace ws-browser --dry-run >"$TMP_DIR/do-ref-key-unsupported.out" 2>"$KEY_UNSUPPORTED_ERR"; then
    fail "unsupported browser saved-ref key unexpectedly succeeded"
fi
expect_error_code "ACTION_INCOMPATIBLE" "$KEY_UNSUPPORTED_ERR"
jq -e '
  .status == "action_incompatible"
  and .ref.ref == "r2"
  and (.supported_actions | index("key") | not)
  and .recommended_next_command == "aos see capture browser:todo --save --workspace ws-browser --mode ax --query \u0027Click me\u0027"
' "$KEY_UNSUPPORTED_ERR" >/dev/null || fail "unsupported browser saved-ref key lacked safe next command: $(cat "$KEY_UNSUPPORTED_ERR")"

if rg -n "maybeRunRefAction|runRefAction" scripts/aos-do-browser.mjs scripts/aos-do-native.mjs >/dev/null; then
    fail "backend do wrappers must not own saved-ref dispatch policy"
fi

BROWSER_WRAPPER_REF_LITERAL_ERR="$TMP_DIR/do-browser-ref-literal.err"
if AOS_AGENT_WORKSPACE=bad/id node scripts/aos-do-browser.mjs type 'ref:literal' 'hello' >"$TMP_DIR/do-browser-ref-literal.out" 2>"$BROWSER_WRAPPER_REF_LITERAL_ERR"; then
    fail "direct browser wrapper accepted ref literal as a browser target"
fi
expect_error_code "INVALID_TARGET" "$BROWSER_WRAPPER_REF_LITERAL_ERR"

FAKE_FORM_AOS="$TMP_DIR/fake-form-aos"
write_fake_form_aos "$FAKE_FORM_AOS"

FORM="$TMP_DIR/capture-form.json"
AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-see-native.mjs capture browser:form --save --mode ax --workspace ws-form --name snapform >"$FORM"
jq -e '
  .status == "success"
  and .refs[0].backend == "browser"
  and .refs[0].resolution_class == "snapshot_scoped"
  and (.refs[0].supported_actions == ["click", "fill", "hover", "scroll", "drag"])
  and .refs[0].conformance.proof_level == "deterministic_contract_tests"
  and (.refs[0].supported_actions | index("type") | not)
  and (.refs[0].supported_actions | index("key") | not)
  and .refs[0].action_target == "browser:form/e42"
' "$FORM" >/dev/null || fail "browser form saved-ref reporting drifted: $(cat "$FORM")"

FORM_FILL_DRY="$TMP_DIR/do-form-fill-dry.json"
AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-do-ref.mjs fill ref:snapform:r1 "hello" --workspace ws-form --dry-run >"$FORM_FILL_DRY"
jq -e '
  .status == "dry_run"
  and .action == "fill"
  and .ref.backend == "browser"
  and .resolved_action.resolution_status == "reacquired"
  and .current_validation.current_target.ref == "e42"
  and .current_validation.current_identity.document_title == "Fixture Todo"
  and (.resolved_action.command | index("browser:form/e42") != null)
  and (.resolved_action.command | index("hello") != null)
' "$FORM_FILL_DRY" >/dev/null || fail "browser fill saved ref dry-run drifted: $(cat "$FORM_FILL_DRY")"

FORM_FILL_MOVED_DRY="$TMP_DIR/do-form-fill-moved-dry.json"
FORM_MOVED=1 AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-do-ref.mjs fill ref:snapform:r1 "hello" --workspace ws-form --dry-run >"$FORM_FILL_MOVED_DRY"
jq -e '
  .status == "dry_run"
  and .action == "fill"
  and .resolved_action.resolution_status == "reacquired"
  and .current_validation.status == "reacquired"
  and .current_validation.current_target.ref == "e42"
  and .current_validation.current_target.bounds.x == 48
  and .current_validation.current_target.bounds.y == 112
  and .current_validation.current_target.role == "textbox"
  and .current_validation.current_target.label == "Search field"
  and (.resolved_action.command | index("browser:form/e42") != null)
' "$FORM_FILL_MOVED_DRY" >/dev/null || fail "browser fill saved ref did not tolerate benign target movement: $(cat "$FORM_FILL_MOVED_DRY")"

FORM_FILL_ACTION="$TMP_DIR/do-form-fill-action.json"
AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-do-ref.mjs fill ref:snapform:r1 "hello" --workspace ws-form >"$FORM_FILL_ACTION"
jq -e '
  .status == "success"
  and .schema_version == "aos.agent-workspace.v0"
  and .action == "fill"
  and .current_validation.status == "reacquired"
  and .current_validation.current_target.ref == "e42"
  and .underlying_result.execution.strategy == "fake_form_fill"
  and (.underlying_result.received | index("browser:form/e42") != null)
  and (.underlying_result.received | index("hello") != null)
  and .post_action.verification == "fresh_capture_recommended"
  and .post_action.recommended_next_command == "aos see capture browser:form --save --workspace ws-form --mode ax"
  and .recommended_next_command == "aos see capture browser:form --save --workspace ws-form --mode ax"
' "$FORM_FILL_ACTION" >/dev/null || fail "browser fill saved ref did not dispatch after validation: $(cat "$FORM_FILL_ACTION")"

FORM_FILL_EXTRA_ERR="$TMP_DIR/do-form-fill-extra.err"
if AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-do-ref.mjs fill ref:snapform:r1 "hello" "again" --workspace ws-form >"$TMP_DIR/do-form-fill-extra.out" 2>"$FORM_FILL_EXTRA_ERR"; then
    fail "browser fill saved ref with extra text unexpectedly succeeded"
fi
expect_error_code "UNKNOWN_ARG" "$FORM_FILL_EXTRA_ERR"

FORM_FILL_STALE_REAL_ERR="$TMP_DIR/do-form-fill-stale-real.err"
if FORM_STALE=1 AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-do-ref.mjs fill ref:snapform:r1 "hello" --workspace ws-form >"$TMP_DIR/do-form-fill-stale-real.out" 2>"$FORM_FILL_STALE_REAL_ERR"; then
    fail "stale browser fill real saved ref unexpectedly executed mutation"
fi
expect_error_code "REF_STALE" "$FORM_FILL_STALE_REAL_ERR"
jq -e '
  .status == "stale_ref"
  and .reason == "current_target_not_found"
  and .backend == "browser"
  and .ref.ref == "r1"
  and .safe_next_action == "aos see capture browser:form --save --workspace ws-form --mode ax"
  and .recommended_next_command == "aos see capture browser:form --save --workspace ws-form --mode ax"
  and .requires_user_approval == false
' "$FORM_FILL_STALE_REAL_ERR" >/dev/null \
    || fail "stale browser fill real action did not expose explicit uncertainty before dispatch: $(cat "$FORM_FILL_STALE_REAL_ERR")"

FORM_STALE_ERR="$TMP_DIR/do-form-fill-stale.err"
if FORM_STALE=1 AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-do-ref.mjs fill ref:snapform:r1 "hello" --workspace ws-form --dry-run >"$TMP_DIR/do-form-fill-stale.out" 2>"$FORM_STALE_ERR"; then
    fail "stale browser fill saved ref unexpectedly succeeded"
fi
expect_error_code "REF_STALE" "$FORM_STALE_ERR"
jq -e '.status == "stale_ref" and .reason == "current_target_not_found" and .backend == "browser" and .ref.ref == "r1" and .recommended_next_command == "aos see capture browser:form --save --workspace ws-form --mode ax"' "$FORM_STALE_ERR" >/dev/null \
    || fail "stale browser fill did not fail closed through current validation: $(cat "$FORM_STALE_ERR")"

FORM_AMBIGUOUS_ERR="$TMP_DIR/do-form-fill-ambiguous.err"
if FORM_AMBIGUOUS=1 AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-do-ref.mjs fill ref:snapform:r1 "hello" --workspace ws-form --dry-run >"$TMP_DIR/do-form-fill-ambiguous.out" 2>"$FORM_AMBIGUOUS_ERR"; then
    fail "ambiguous browser fill saved ref unexpectedly succeeded"
fi
expect_error_code "REF_AMBIGUOUS" "$FORM_AMBIGUOUS_ERR"
jq -e '.status == "ambiguous" and .reason == "current_target_ambiguous" and .backend == "browser" and (.candidates | length) == 2' "$FORM_AMBIGUOUS_ERR" >/dev/null \
    || fail "ambiguous browser fill did not fail closed with candidates: $(cat "$FORM_AMBIGUOUS_ERR")"

FORM_DISABLED_ERR="$TMP_DIR/do-form-fill-disabled.err"
if FORM_DISABLED=1 AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-do-ref.mjs fill ref:snapform:r1 "hello" --workspace ws-form >"$TMP_DIR/do-form-fill-disabled.out" 2>"$FORM_DISABLED_ERR"; then
    fail "disabled browser fill saved ref unexpectedly dispatched"
fi
expect_error_code "ACTION_INCOMPATIBLE" "$FORM_DISABLED_ERR"
jq -e '.status == "action_incompatible" and .reason == "target_disabled"' "$FORM_DISABLED_ERR" >/dev/null \
    || fail "disabled browser fill did not fail closed before dispatch: $(cat "$FORM_DISABLED_ERR")"

for drift in ROLE TITLE LABEL CONTEXT; do
    case "$drift" in
        ROLE) drift_lower="role" ;;
        TITLE) drift_lower="title" ;;
        LABEL) drift_lower="label" ;;
        CONTEXT) drift_lower="context" ;;
    esac
    err="$TMP_DIR/do-form-fill-${drift_lower}-drift.err"
    env_name="FORM_${drift}_DRIFT"
    if env "$env_name=1" AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-do-ref.mjs fill ref:snapform:r1 "hello" --workspace ws-form >"$TMP_DIR/do-form-fill-${drift_lower}-drift.out" 2>"$err"; then
        fail "${drift} drift browser fill saved ref unexpectedly dispatched"
    fi
    expect_error_code "REF_STALE" "$err"
    jq -e '.status == "stale_ref" and (.reason | endswith("_changed"))' "$err" >/dev/null \
        || fail "${drift} drift did not fail closed with stale reason: $(cat "$err")"
done

FORM_URL_DRIFT_ERR="$TMP_DIR/do-form-fill-url-drift.err"
if FAKE_PWCLI_PAGE_URL="https://fixture.local/other" AOS_PATH="$FAKE_FORM_AOS" node scripts/aos-do-ref.mjs fill ref:snapform:r1 "hello" --workspace ws-form >"$TMP_DIR/do-form-fill-url-drift.out" 2>"$FORM_URL_DRIFT_ERR"; then
    fail "URL drift browser fill saved ref unexpectedly dispatched"
fi
expect_error_code "REF_STALE" "$FORM_URL_DRIFT_ERR"
jq -e '.status == "stale_ref" and .reason == "page_url_changed" and .current_identity.page_url == "https://fixture.local/other"' "$FORM_URL_DRIFT_ERR" >/dev/null \
    || fail "URL drift did not fail closed through page identity validation: $(cat "$FORM_URL_DRIFT_ERR")"

NON_CLICK_AOS="$TMP_DIR/non-click-aos"
write_non_click_ref_literal_aos "$NON_CLICK_AOS"

NON_CLICK_LITERAL="$TMP_DIR/non-click-ref-literal.json"
AOS_AGENT_WORKSPACE=bad/id AOS_PATH="$NON_CLICK_AOS" node scripts/aos-do-native.mjs type 'ref:literal' --dry-run >"$NON_CLICK_LITERAL"
jq -e '
  .status == "success"
  and (.received | index("__do") != null)
  and (.received | index("type") != null)
  and (.received | index("ref:literal") != null)
' "$NON_CLICK_LITERAL" >/dev/null || fail "non-click ref literal was not passed through without workspace resolution: $(cat "$NON_CLICK_LITERAL")"

echo "PASS browser refs"
