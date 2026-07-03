#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/tests/lib/agent-workspace-fixtures.sh"
agent_workspace_test_setup

FAILING_AOS="$TMP_DIR/failing-aos"
write_failing_capture_aos "$FAILING_AOS"
NATIVE_FILE_AOS="$TMP_DIR/native-file-aos"
write_native_file_capture_aos "$NATIVE_FILE_AOS"

CONFLICT_OUT="$TMP_DIR/save-out-conflict.png"
CONFLICT_WORKSPACE="$AOS_STATE_ROOT/repo/agent-workspaces/ws-out-conflict"
expect_command_error_code \
    "INVALID_ARG" \
    "save-out-conflict" \
    ./aos see capture browser:todo --save --mode ax --workspace ws-out-conflict --name snapout --out "$CONFLICT_OUT"
[[ ! -e "$CONFLICT_WORKSPACE" ]] \
    || fail "save/out conflict created workspace state: $CONFLICT_WORKSPACE"
[[ ! -e "$CONFLICT_OUT" ]] \
    || fail "save/out conflict wrote caller output path: $CONFLICT_OUT"

FAILED_CAPTURE_ERR="$TMP_DIR/failing-capture.err"
if AOS_PATH="$FAILING_AOS" node scripts/aos-see-native.mjs capture --save --mode ax --workspace ws-fail --name snapfail >"$TMP_DIR/failing-capture.out" 2>"$FAILED_CAPTURE_ERR"; then
    fail "failing primitive saved capture unexpectedly succeeded"
else
    FAILED_CAPTURE_STATUS=$?
fi
[[ "$FAILED_CAPTURE_STATUS" -eq 7 ]] || fail "failing primitive exited $FAILED_CAPTURE_STATUS instead of 7: $(cat "$FAILED_CAPTURE_ERR")"
grep -q "primitive exploded" "$FAILED_CAPTURE_ERR" \
    || fail "failing primitive stderr was not forwarded: $(cat "$FAILED_CAPTURE_ERR")"
FAILED_WORKSPACE="$AOS_STATE_ROOT/repo/agent-workspaces/ws-fail"
[[ ! -e "$FAILED_WORKSPACE/.write-lock" ]] \
    || fail "failing primitive left workspace lock behind"
[[ ! -e "$FAILED_WORKSPACE/snapshots/snapfail" ]] \
    || fail "failing primitive left committed-looking snapshot directory behind"
[[ ! -e "$FAILED_WORKSPACE/snapshots/.staging" ]] \
    || [[ -z "$(find "$FAILED_WORKSPACE/snapshots/.staging" -mindepth 1 -maxdepth 1 -print -quit)" ]] \
    || fail "failing primitive left staged snapshot directories behind"
if [[ -f "$FAILED_WORKSPACE/index.json" ]]; then
    jq -e '.current_snapshot_id == null and ([.snapshots[].snapshot_id] | index("snapfail") | not)' "$FAILED_WORKSPACE/index.json" >/dev/null \
        || fail "failing primitive left index entry: $(cat "$FAILED_WORKSPACE/index.json")"
fi

NATIVE_FILE_CAPTURE="$TMP_DIR/native-file-capture.json"
AOS_PATH="$NATIVE_FILE_AOS" node scripts/aos-see-native.mjs capture main --save --mode ax --workspace ws-native-file --name snapnativefile >"$NATIVE_FILE_CAPTURE"
NATIVE_FILE_ARTIFACT="$(jq -r '.artifact_refs[0].path' "$NATIVE_FILE_CAPTURE")"
jq -e '
  .status == "success"
  and .capture_mode == "ax"
  and .capture_target == "main"
  and .capture_source.kind == "target"
  and .capture_source.argv == ["main"]
  and .counts.files == 1
  and .counts.elements == 1
  and .counts.refs == 1
  and .artifact_refs[0].role == "capture_image"
  and .artifact_refs[0].stored_under_workspace == true
  and (.artifact_refs[0].path | endswith("/snapshots/snapnativefile/artifacts/capture.png"))
  and .artifact_refs[0].path != "./screenshot.png"
  and .refs[0].backend == "native_ax"
  and .refs[0].artifact_refs[0].stored_under_workspace == true
  and (.omitted.heavy_payloads | index("elements") != null)
  and (has("elements") | not)
' "$NATIVE_FILE_CAPTURE" >/dev/null || fail "native saved capture did not keep image artifact under workspace: $(cat "$NATIVE_FILE_CAPTURE")"
[[ -f "$NATIVE_FILE_ARTIFACT" ]] || fail "native saved capture artifact missing: $NATIVE_FILE_ARTIFACT"
assert_no_heavy_capture_payloads "$NATIVE_FILE_CAPTURE" "native saved capture output"

REGION_SOURCE_CAPTURE="$TMP_DIR/region-source-capture.json"
AOS_PATH="$NATIVE_FILE_AOS" node scripts/aos-see-native.mjs capture --region 0,0,10,10 --save --mode ax --workspace ws-region --name snapregion >"$REGION_SOURCE_CAPTURE"
REGION_SOURCE_SNAPSHOT="$(jq -r '.paths.snapshot_record' "$REGION_SOURCE_CAPTURE")"
jq -e '
  .status == "success"
  and .capture_target == "main"
  and .capture_source.kind == "source_flags"
  and .capture_source.argv == ["--region", "0,0,10,10"]
  and .refs[0].capture_source.argv == ["--region", "0,0,10,10"]
' "$REGION_SOURCE_CAPTURE" >/dev/null || fail "saved region source was not persisted in compact output: $(cat "$REGION_SOURCE_CAPTURE")"
jq -e '
  .capture_target == "main"
  and .capture_source.kind == "source_flags"
  and .capture_source.argv == ["--region", "0,0,10,10"]
' "$REGION_SOURCE_SNAPSHOT" >/dev/null || fail "saved region source was not persisted in snapshot record: $(cat "$REGION_SOURCE_SNAPSHOT")"
REGION_SOURCE_REFS="$TMP_DIR/region-source-refs.json"
./aos see refs --workspace ws-region --snapshot snapregion --query 0,0,10,10 --json >"$REGION_SOURCE_REFS"
jq -e '
  .status == "success"
  and .query == "0,0,10,10"
  and (.refs | length) == 1
  and .refs[0].capture_source.argv == ["--region", "0,0,10,10"]
' "$REGION_SOURCE_REFS" >/dev/null || fail "source-flag ref query did not match capture_source: $(cat "$REGION_SOURCE_REFS")"

CAP1="$TMP_DIR/capture-snap1.json"
./aos see capture browser:todo --save --mode ax --workspace ws1 --name snap1 --query button >"$CAP1"
jq -e '
  .status == "success"
  and .schema_version == "aos.agent-workspace.v0"
  and .workspace_id == "ws1"
  and .snapshot_id == "snap1"
  and .runtime_mode == "repo"
  and .capture_mode == "ax"
  and .capture_target == "browser:todo"
  and .capture_source.kind == "target"
  and .capture_source.argv == ["browser:todo"]
  and .target == "browser:todo"
  and .query == "button"
  and .counts.files == 0
  and .counts.elements == 3
  and .counts.refs == 3
  and (.artifact_refs | length) == 0
  and (.refs | length) == 1
  and .refs[0].ref == "r2"
  and .refs[0].ref_scope == "snapshot"
  and .refs[0].workspace_id == "ws1"
  and .refs[0].snapshot_id == "snap1"
  and .refs[0].capture_target == "browser:todo"
  and .refs[0].capture_source.argv == ["browser:todo"]
  and .refs[0].capture_mode == "ax"
  and .refs[0].backend == "browser"
  and .refs[0].resolution_class == "snapshot_scoped"
  and .refs[0].confidence == "medium"
  and (.refs[0].supported_actions | index("click") != null)
  and .refs[0].identity_facts.source_ref == "e2"
  and .refs[0].identity_facts.page_url == "https://fixture.local/todo"
  and (.refs[0].hint_facts.role | length > 0)
  and .refs[0].current_address.action_target == "browser:todo/e2"
  and (.refs[0].artifact_refs | type == "array")
  and (.refs[0].warnings[0] | contains("real mutation dispatches only after"))
  and (.omitted.heavy_payloads | index("elements") != null)
  and (.paths.capture | endswith("/capture.json"))
  and (.paths.snapshot_record | endswith("/snapshot.json"))
  and (has("elements") | not)
  and (has("semantic_targets") | not)
  and (has("base64") | not)
' "$CAP1" >/dev/null || fail "compact saved capture shape drifted: $(cat "$CAP1")"
assert_no_heavy_capture_payloads "$CAP1" "saved capture output"

CAP1_REFS_BY_CONTEXT="$TMP_DIR/refs-query-context.json"
./aos see refs --workspace ws1 --snapshot snap1 --query browser:todo --json >"$CAP1_REFS_BY_CONTEXT"
jq -e '
  .status == "success"
  and .schema_version == "aos.agent-workspace.v0"
  and .workspace_id == "ws1"
  and .snapshot_id == "snap1"
  and .query == "browser:todo"
  and (.refs | length) == 3
  and all(.refs[];
    .ref_scope == "snapshot"
    and .workspace_id == "ws1"
    and .snapshot_id == "snap1"
    and .capture_target == "browser:todo"
    and .capture_source.argv == ["browser:todo"]
    and .capture_mode == "ax"
    and (.supported_actions | type == "array")
    and (.identity_facts | has("state_id"))
    and (.identity_facts | has("source_ref"))
    and (.current_address | has("action_target"))
    and (.conformance | has("proof"))
    and (.conformance | has("no_foreground"))
    and (.conformance | has("target_uncertainty"))
    and (has("elements") | not)
    and (has("semantic_targets") | not)
    and (has("base64") | not)
    and (has("short_action_target") | not)
  )
' "$CAP1_REFS_BY_CONTEXT" >/dev/null \
    || fail "ref query did not match compact capture context: $(cat "$CAP1_REFS_BY_CONTEXT")"

CAP1_REFS_BY_PROOF="$TMP_DIR/refs-query-proof.json"
./aos see refs --workspace ws1 --snapshot snap1 --query deterministic_contract_tests_passed --json >"$CAP1_REFS_BY_PROOF"
jq -e '
  .status == "success"
  and .workspace_id == "ws1"
  and .snapshot_id == "snap1"
  and .query == "deterministic_contract_tests_passed"
  and (.refs | length) == 3
  and all(.refs[];
    .conformance.proof.status == "deterministic_contract_tests_passed"
    and .conformance.target_uncertainty.status == "requires_current_validation"
    and (has("elements") | not)
    and (has("semantic_targets") | not)
    and (has("base64") | not)
  )
' "$CAP1_REFS_BY_PROOF" >/dev/null \
    || fail "ref query did not match model-facing proof metadata: $(cat "$CAP1_REFS_BY_PROOF")"

CAPTURE_PATH="$(jq -r '.paths.capture' "$CAP1")"
SUMMARY_PATH="$(jq -r '.paths.summary' "$CAP1")"
SNAPSHOT_RECORD_PATH="$(jq -r '.paths.snapshot_record' "$CAP1")"
REFS_PATH="$(jq -r '.paths.refs' "$CAP1")"
WORKSPACE_PATH="$(jq -r '.paths.workspace' "$CAP1")"
COMMIT_MARKER="$WORKSPACE_PATH/snapshots/snap1/committed.json"

[[ -f "$CAPTURE_PATH" ]] || fail "missing capture payload: $CAPTURE_PATH"
[[ -f "$SUMMARY_PATH" ]] || fail "missing summary payload: $SUMMARY_PATH"
[[ -f "$SNAPSHOT_RECORD_PATH" ]] || fail "missing snapshot record: $SNAPSHOT_RECORD_PATH"
[[ -f "$REFS_PATH" ]] || fail "missing refs payload: $REFS_PATH"
[[ -f "$COMMIT_MARKER" ]] || fail "missing committed marker: $COMMIT_MARKER"
[[ -f "$WORKSPACE_PATH/workspace.json" ]] || fail "missing workspace metadata: $WORKSPACE_PATH/workspace.json"
[[ -f "$WORKSPACE_PATH/index.json" ]] || fail "missing workspace index: $WORKSPACE_PATH/index.json"
jq -e '.workspace_id == "ws1" and .snapshot_id == "snap1" and .snapshot_record == "snapshot.json"' "$COMMIT_MARKER" >/dev/null \
    || fail "committed marker shape drifted: $(cat "$COMMIT_MARKER")"
jq -e '.query == "button"' "$SNAPSHOT_RECORD_PATH" >/dev/null \
    || fail "snapshot record omitted saved query: $(cat "$SNAPSHOT_RECORD_PATH")"
jq -e '.capture_source.argv == ["browser:todo"]' "$SNAPSHOT_RECORD_PATH" >/dev/null \
    || fail "snapshot record omitted saved capture source: $(cat "$SNAPSHOT_RECORD_PATH")"
jq -e 'has("current_snapshot_id") | not' "$WORKSPACE_PATH/workspace.json" >/dev/null \
    || fail "workspace metadata must not own current_snapshot_id"
jq -e '.current_snapshot_id == "snap1" and (.snapshots | length) == 1' "$WORKSPACE_PATH/index.json" >/dev/null \
    || fail "workspace index did not rebuild to snap1"
jq -e '
  .snapshots[0].snapshot_id == "snap1"
  and .snapshots[0].capture_target == "browser:todo"
  and .snapshots[0].capture_source.argv == ["browser:todo"]
  and .snapshots[0].target == "browser:todo"
  and .snapshots[0].query == "button"
' "$WORKSPACE_PATH/index.json" >/dev/null || fail "workspace index omitted compact target/query readback: $(cat "$WORKSPACE_PATH/index.json")"
jq -e '(.elements | length == 3) and ((.files // []) | all(contains("/.staging/") | not))' "$CAPTURE_PATH" >/dev/null \
    || fail "full capture retained staged artifact paths: $(cat "$CAPTURE_PATH")"
jq -e '(has("elements") | not) and (has("semantic_targets") | not) and (has("base64") | not)' "$SUMMARY_PATH" >/dev/null \
    || fail "summary leaked heavy capture payloads"

validate_agent_workspace_schema \
    "$CAP1" \
    "$SUMMARY_PATH" \
    "$SNAPSHOT_RECORD_PATH" \
    "$REFS_PATH" \
    "$WORKSPACE_PATH/workspace.json" \
    "$WORKSPACE_PATH/index.json"

BAD_REFS="$TMP_DIR/bad-refs-missing-state-id.json"
jq 'del(.refs[0].identity_facts.state_id)' "$REFS_PATH" >"$BAD_REFS"
expect_agent_workspace_schema_rejects "$BAD_REFS"

BAD_SNAPSHOT_MISSING_QUERY="$TMP_DIR/bad-snapshot-missing-query.json"
jq 'del(.query)' "$SNAPSHOT_RECORD_PATH" >"$BAD_SNAPSHOT_MISSING_QUERY"
expect_agent_workspace_schema_rejects "$BAD_SNAPSHOT_MISSING_QUERY"
cp "$SNAPSHOT_RECORD_PATH" "$SNAPSHOT_RECORD_PATH.valid-test-backup"
cp "$BAD_SNAPSHOT_MISSING_QUERY" "$SNAPSHOT_RECORD_PATH"
BAD_SNAPSHOT_QUERY_ERR="$TMP_DIR/bad-snapshot-missing-query.err"
if ./aos see refs --workspace ws1 --snapshot snap1 --json >"$TMP_DIR/bad-snapshot-missing-query.out" 2>"$BAD_SNAPSHOT_QUERY_ERR"; then
    mv "$SNAPSHOT_RECORD_PATH.valid-test-backup" "$SNAPSHOT_RECORD_PATH"
    fail "runtime accepted snapshot record missing query"
fi
expect_corrupt_state "$SNAPSHOT_RECORD_PATH" "$BAD_SNAPSHOT_QUERY_ERR"
mv "$SNAPSHOT_RECORD_PATH.valid-test-backup" "$SNAPSHOT_RECORD_PATH"

BAD_BACKEND_REFS="$TMP_DIR/bad-refs-backend.json"
jq '.refs[0].backend = "surprise_backend"' "$REFS_PATH" >"$BAD_BACKEND_REFS"
cp "$REFS_PATH" "$REFS_PATH.valid-test-backup"
cp "$BAD_BACKEND_REFS" "$REFS_PATH"
BAD_BACKEND_ERR="$TMP_DIR/bad-backend-refs.err"
if ./aos see refs --workspace ws1 --snapshot snap1 --json >"$TMP_DIR/bad-backend-refs.out" 2>"$BAD_BACKEND_ERR"; then
    mv "$REFS_PATH.valid-test-backup" "$REFS_PATH"
    fail "runtime accepted unsupported backend enum"
fi
expect_corrupt_state "$REFS_PATH" "$BAD_BACKEND_ERR"
mv "$REFS_PATH.valid-test-backup" "$REFS_PATH"

with_corrupt_file "$WORKSPACE_PATH/workspace.json" ./aos see workspace ws1 --json
with_corrupt_file "$SNAPSHOT_RECORD_PATH" ./aos see refs --workspace ws1 --snapshot snap1 --json
with_corrupt_file "$REFS_PATH" ./aos see refs --workspace ws1 --snapshot snap1 --json

printf '{' >"$WORKSPACE_PATH/index.json"
REBUILT_SNAPS="$TMP_DIR/rebuilt-snapshots.json"
./aos see snapshots --workspace ws1 --json >"$REBUILT_SNAPS"
jq -e '.status == "success" and .current_snapshot_id == "snap1" and (.snapshots | length) == 1 and .snapshots[0].snapshot_id == "snap1"' "$REBUILT_SNAPS" >/dev/null \
    || fail "corrupt index did not derive from committed snapshot: $(cat "$REBUILT_SNAPS")"
jq -e '.snapshots[0].capture_target == "browser:todo" and .snapshots[0].target == "browser:todo" and .snapshots[0].query == "button"' "$REBUILT_SNAPS" >/dev/null \
    || fail "snapshots readback did not expose compact target/query: $(cat "$REBUILT_SNAPS")"
assert_no_heavy_capture_payloads "$REBUILT_SNAPS" "snapshots readback"
[[ "$(cat "$WORKSPACE_PATH/index.json")" == "{" ]] \
    || fail "read-only snapshots command rewrote corrupt index: $(cat "$WORKSPACE_PATH/index.json")"

mkdir -p "$WORKSPACE_PATH/snapshots/partial-one/artifacts"
printf '{}' >"$WORKSPACE_PATH/snapshots/partial-one/snapshot.json"
mkdir -p "$WORKSPACE_PATH/snapshots/.staging/staged-one/artifacts"
rm "$WORKSPACE_PATH/index.json"
NO_INDEX_REFS="$TMP_DIR/no-index-refs.json"
./aos see refs --workspace ws1 --snapshot snap1 --json >"$NO_INDEX_REFS"
jq -e '.status == "success" and .snapshot_id == "snap1" and (.refs | length) == 3' "$NO_INDEX_REFS" >/dev/null \
    || fail "refs read without index did not derive committed state: $(cat "$NO_INDEX_REFS")"
jq -e '
  .schema_version == "aos.agent-workspace.v0"
  and .workspace_id == "ws1"
  and .query == null
  and all(.refs[];
    .ref_scope == "snapshot"
    and .workspace_id == "ws1"
    and .snapshot_id == "snap1"
    and .capture_target == "browser:todo"
    and .capture_source.argv == ["browser:todo"]
    and .capture_mode == "ax"
    and (.supported_actions | type == "array")
    and (.identity_facts | has("state_id"))
    and (.identity_facts | has("source_ref"))
    and (.current_address | has("action_target"))
    and (.conformance | has("proof"))
    and (.conformance | has("no_foreground"))
    and (.conformance | has("target_uncertainty"))
    and (has("short_action_target") | not)
  )
' "$NO_INDEX_REFS" >/dev/null \
    || fail "refs read without index did not expose compact ref summaries: $(cat "$NO_INDEX_REFS")"
assert_no_heavy_capture_payloads "$NO_INDEX_REFS" "refs readback without index"
[[ ! -e "$WORKSPACE_PATH/index.json" ]] \
    || fail "read-only refs command recreated index: $(cat "$WORKSPACE_PATH/index.json")"

NO_INDEX_WORKSPACE="$TMP_DIR/no-index-workspace.json"
./aos see workspace ws1 --json >"$NO_INDEX_WORKSPACE"
jq -e '.status == "success" and .index_health.current_snapshot_id == "snap1" and .index_health.snapshot_count == 1' "$NO_INDEX_WORKSPACE" >/dev/null \
    || fail "workspace read without index did not derive committed state: $(cat "$NO_INDEX_WORKSPACE")"
jq -e '.index_health.current_snapshot.capture_target == "browser:todo" and .index_health.current_snapshot.query == "button"' "$NO_INDEX_WORKSPACE" >/dev/null \
    || fail "workspace read did not expose compact current snapshot target/query: $(cat "$NO_INDEX_WORKSPACE")"
assert_no_heavy_capture_payloads "$NO_INDEX_WORKSPACE" "workspace readback"
[[ ! -e "$WORKSPACE_PATH/index.json" ]] \
    || fail "read-only workspace command recreated index: $(cat "$WORKSPACE_PATH/index.json")"

NO_INDEX_WORKSPACES="$TMP_DIR/no-index-workspaces.json"
./aos see workspaces --json >"$NO_INDEX_WORKSPACES"
jq -e '.status == "success" and any(.workspaces[]; .workspace_id == "ws1" and .current_snapshot_id == "snap1" and .snapshot_count == 1)' "$NO_INDEX_WORKSPACES" >/dev/null \
    || fail "workspaces read without index did not derive committed state: $(cat "$NO_INDEX_WORKSPACES")"
assert_no_heavy_capture_payloads "$NO_INDEX_WORKSPACES" "workspaces readback"
[[ ! -e "$WORKSPACE_PATH/index.json" ]] \
    || fail "read-only workspaces command recreated index: $(cat "$WORKSPACE_PATH/index.json")"

RECONCILED_SNAPS="$TMP_DIR/reconciled-snapshots.json"
./aos see snapshots --workspace ws1 --json >"$RECONCILED_SNAPS"
jq -e '
  .status == "success"
  and .current_snapshot_id == "snap1"
  and (.snapshots | length) == 1
  and ([.snapshots[].snapshot_id] | index("snap1") != null and index("partial-one") == null and index("staged-one") == null)
  and .snapshots[0].capture_target == "browser:todo"
  and .snapshots[0].target == "browser:todo"
  and .snapshots[0].query == "button"
' "$RECONCILED_SNAPS" >/dev/null || fail "index rebuild included uncommitted snapshots: $(cat "$RECONCILED_SNAPS")"
assert_no_heavy_capture_payloads "$RECONCILED_SNAPS" "missing-index snapshots readback"
[[ ! -e "$WORKSPACE_PATH/index.json" ]] \
    || fail "read-only snapshots command recreated missing index: $(cat "$WORKSPACE_PATH/index.json")"

PARTIAL_REF_ERR="$TMP_DIR/partial-ref.err"
if ./aos see refs --workspace ws1 --snapshot partial-one --json >"$TMP_DIR/partial-ref.out" 2>"$PARTIAL_REF_ERR"; then
    fail "uncommitted partial snapshot was loadable"
fi
expect_error_code "SNAPSHOT_NOT_FOUND" "$PARTIAL_REF_ERR"

SNAP_EXISTS_ERR="$TMP_DIR/snapshot-exists.err"
if ./aos see capture browser:todo --save --mode ax --workspace ws1 --name snap1 >"$TMP_DIR/snapshot-exists.out" 2>"$SNAP_EXISTS_ERR"; then
    fail "duplicate committed snapshot unexpectedly succeeded"
fi
expect_error_code "SNAPSHOT_EXISTS" "$SNAP_EXISTS_ERR"
[[ -f "$SNAPSHOT_RECORD_PATH" ]] \
    || fail "duplicate snapshot removed the existing snapshot record"

CAP2="$TMP_DIR/capture-snap2.json"
./aos see capture browser:todo --save --mode ax --workspace ws1 --name snap2 >"$CAP2"
jq -e '.status == "success" and .snapshot_id == "snap2" and .capture_mode == "ax"' "$CAP2" >/dev/null \
    || fail "second capture failed: $(cat "$CAP2")"
jq -e '(.current_snapshot_id == "snap2") and ([.snapshots[].snapshot_id] | index("snap1") != null and index("snap2") != null and index("partial-one") == null)' "$WORKSPACE_PATH/index.json" >/dev/null \
    || fail "sequential saves did not preserve committed snapshot index entries: $(cat "$WORKSPACE_PATH/index.json")"
jq -e '
  any(.snapshots[]; .snapshot_id == "snap1" and .capture_target == "browser:todo" and .query == "button")
  and any(.snapshots[]; .snapshot_id == "snap2" and .capture_target == "browser:todo" and .query == null)
' "$WORKSPACE_PATH/index.json" >/dev/null || fail "sequential saves did not preserve compact snapshot target/query entries: $(cat "$WORKSPACE_PATH/index.json")"

VISION="$TMP_DIR/capture-vision.json"
./aos see capture browser:todo --save --mode vision --workspace ws-vision --name snapv >"$VISION"
ARTIFACT="$(jq -r '.artifact_refs[0].path' "$VISION")"
jq -e '.status == "success" and .capture_mode == "vision" and .counts.files == 1 and .counts.refs == 0' "$VISION" >/dev/null \
    || fail "vision saved capture shape drifted: $(cat "$VISION")"
assert_no_heavy_capture_payloads "$VISION" "vision saved capture output"
[[ -f "$ARTIFACT" ]] || fail "vision capture did not keep screenshot file-backed at final path: $ARTIFACT"

SOM="$TMP_DIR/capture-som.json"
./aos see capture browser:todo --save --mode som --workspace ws-som --name snapsom >"$SOM"
SOM_ARTIFACT="$(jq -r '.artifact_refs[0].path' "$SOM")"
jq -e '.status == "success" and .capture_mode == "som" and .counts.files == 1 and .counts.elements == 3 and .counts.refs == 3 and (.omitted.heavy_payloads | index("annotations") != null)' "$SOM" >/dev/null \
    || fail "som saved capture did not combine browser refs and image pointers: $(cat "$SOM")"
assert_no_heavy_capture_payloads "$SOM" "som saved capture output"
[[ -f "$SOM_ARTIFACT" ]] || fail "som capture did not keep screenshot file-backed at final path: $SOM_ARTIFACT"

BAD_MODE_ERR="$TMP_DIR/bad-mode.err"
if ./aos see capture browser:todo --save --mode bad --workspace ws1 --name badmode >"$TMP_DIR/bad-mode.out" 2>"$BAD_MODE_ERR"; then
    fail "invalid capture mode unexpectedly succeeded"
fi
expect_error_code "INVALID_ARG" "$BAD_MODE_ERR"

NO_SAVE_MODE_ERR="$TMP_DIR/no-save-mode.err"
if ./aos see capture browser:todo --mode ax >"$TMP_DIR/no-save-mode.out" 2>"$NO_SAVE_MODE_ERR"; then
    fail "workspace-only --mode without --save unexpectedly succeeded"
fi
expect_error_code "INVALID_ARG" "$NO_SAVE_MODE_ERR"
jq -e '.error == "--mode requires --save"' "$NO_SAVE_MODE_ERR" >/dev/null \
    || fail "--mode without --save did not fail clearly: $(cat "$NO_SAVE_MODE_ERR")"

echo "PASS storage"
